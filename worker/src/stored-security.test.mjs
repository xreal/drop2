import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRuntime, storedBody } from '../test/runtime.mjs';

let runtime;
before(async () => { runtime = await createRuntime(); });
after(async () => { await runtime?.mf.dispose(); });

test('rejects the one-byte declaration with a 16 MiB storage budget', async () => {
  const response = await runtime.request('/api/v1/stored', storedBody(1, {
    chunk_count:2, ciphertext_bytes_total:16 * 1024 * 1024 + 1,
  }));
  assert.equal(response.status, 400);
  assert.equal((await runtime.sql('SELECT COUNT(*) AS count FROM stored_shares'))[0].count, 0);
});

test('omitting browser fields cannot bypass anonymous size limits', async () => {
  const body = storedBody(11 * 1024 * 1024);
  delete body.expiry_mode;
  delete body.max_downloads;
  body.expires_seconds = 3600;
  const response = await runtime.request('/api/v1/stored', body);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'auth_required');
});

test('upload endpoints reject oversized and undersized bodies before storing them', async () => {
  const response = await runtime.request('/api/v1/stored', storedBody());
  const share = await response.json();
  const base = `/api/v1/stored/${share.share_id}`;
  const options = {method:'PUT', headers:{'x-drop2-upload-token':share.upload_token}};
  assert.equal((await runtime.request(base + '/manifest', new Uint8Array(2), options)).status, 400);
  assert.equal((await runtime.request(base + '/chunks/1', new Uint8Array(25), options)).status, 400);
  assert.equal((await runtime.request(base + '/chunks/1', new Uint8Array(23), options)).status, 400);
  const objects = await (await runtime.request('/_test/objects')).json();
  assert.equal(objects.objects.filter(object => object.key.includes(share.storage_prefix)).length, 0);
  assert.equal((await runtime.request(base + '/manifest', new Uint8Array(1), options)).status, 200);
  assert.equal((await runtime.request(base + '/chunks/1', new Uint8Array(24), options)).status, 200);
  assert.equal((await runtime.request(base + '/complete', {upload_token:share.upload_token})).status, 200);
});

async function accountOptions(id) {
  const token = `test-session-${id}`;
  const hash = createHash('sha256').update(token).digest('hex');
  await runtime.sql(`INSERT INTO accounts
    (account_id, github_user_id, github_login, github_created_at, public_repos, eligible, status, created_at, updated_at)
    VALUES (?, ?, 'test', 1, 2, 1, 'active', 1, 1)`, [id, Number(id)]);
  await runtime.sql(`INSERT INTO sessions (session_id, account_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, 1)`, [id, id, hash, Date.now() + 600_000]);
  return {headers:{cookie:`drop2_session=${token}`}};
}

test('concurrent creates reserve account quota and stale uploads release it', async () => {
  const options = await accountOptions('100');
  const size = 800 * 1024 * 1024;
  const responses = await Promise.all(Array.from({length:2}, () =>
    runtime.request('/api/v1/stored', storedBody(size), options)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 403]);
  const share = await responses.find(response => response.status === 200).json();
  const session = await (await runtime.request('/api/v1/auth/session', undefined, options)).json();
  assert.equal(session.quota.day_bytes, size);
  // Uploading rows themselves reserve quota even before any completion event exists.
  assert.equal((await runtime.sql('SELECT COUNT(*) AS count FROM usage_events WHERE account_id = ?', ['100']))[0].count, 0);
  assert.equal((await runtime.request(`/api/v1/stored/${share.share_id}/manifest`, new Uint8Array(1), {
    method:'PUT', headers:{'x-drop2-upload-token':share.upload_token},
  })).status, 200);
  await runtime.sql('UPDATE stored_shares SET created_at = ? WHERE share_id = ?', [Date.now() - 86_400_001, share.share_id]);
  assert.equal((await runtime.request('/_test/cleanup')).status, 200);
  const afterCleanup = await (await runtime.request('/api/v1/auth/session', undefined, options)).json();
  assert.equal(afterCleanup.quota.day_bytes, 0);
  const objects = await (await runtime.request('/_test/objects')).json();
  assert.equal(objects.objects.filter(object => object.key.includes(share.storage_prefix)).length, 0);
});

test('completion atomically converts a reservation into one usage event', async () => {
  const options = await accountOptions('101');
  const share = await runtime.uploadSmall(storedBody(), options, false);
  const before = await (await runtime.request('/api/v1/auth/session', undefined, options)).json();
  assert.equal(before.quota.day_bytes, 4);
  const completed = await Promise.all(Array.from({length:2}, () =>
    runtime.request(share.base + '/complete', {upload_token:share.upload_token})));
  assert.deepEqual(completed.map(response => response.status).sort(), [200, 403]);
  const afterComplete = await (await runtime.request('/api/v1/auth/session', undefined, options)).json();
  assert.equal(afterComplete.quota.day_bytes, 4);
  assert.equal((await runtime.sql('SELECT COUNT(*) AS count FROM usage_events WHERE share_id = ?', [share.share_id]))[0].count, 1);
});
