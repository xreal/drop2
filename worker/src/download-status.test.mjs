import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, storedBody, pin } from '../test/runtime.mjs';

let runtime;
before(async () => { runtime = await createRuntime(); });
after(async () => { await runtime?.mf.dispose(); });

function status(share, token = share.download_status_token) {
  return runtime.request(share.base + '/download-status', undefined, {
    headers: { 'x-drop2-status-token': token ?? '' },
  });
}

async function access(share) {
  return (await (await runtime.request(share.base + '/access', { pin })).json()).download_token;
}

function complete(share, token, body = { bytes_received: 4 }) {
  return runtime.request(share.base + '/download-complete', body, {
    headers: { 'x-drop2-download-token': token },
  });
}

test('only the sender status token reveals receipts; access alone is not completion', async () => {
  const share = await runtime.uploadSmall();
  assert.equal(typeof share.download_status_token, 'string');
  for (const token of ['', share.upload_token, share.email_notify_token, 'wrong']) {
    assert.equal((await status(share, token)).status, 404);
  }
  const downloadToken = await access(share);
  assert.equal((await status(share, downloadToken)).status, 404);
  const response = await status(share);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).downloaded_at, null);
  assert.equal((await complete(share, 'wrong')).status, 401);
  for (const body of [{}, {bytes_received: null}, {bytes_received: '4'}, {bytes_received: 3}, {bytes_received: 4.5}]) {
    assert.equal((await complete(share, downloadToken, body)).status, 400);
  }
  assert.equal((await (await status(share)).json()).downloaded_at, null);
  assert.equal((await complete(share, downloadToken)).status, 200);
  const received = await (await status(share)).json();
  assert.ok(received.downloaded_at > 0);
  assert.equal(received.state, 'ready');
  await complete(share, downloadToken);
  assert.equal((await (await status(share)).json()).downloaded_at, received.downloaded_at);
});

test('receipt survives deletion and concurrent completion', async () => {
  const share = await runtime.uploadSmall(storedBody(4, { expiry_mode: 'after_download' }));
  const token = await access(share);
  const responses = await Promise.all([complete(share, token), complete(share, token)]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const received = await (await status(share)).json();
  assert.equal(received.state, 'deleted');
  assert.ok(received.downloaded_at > 0);
  await runtime.request('/_test/cleanup');
  assert.equal((await (await status(share)).json()).downloaded_at, received.downloaded_at);
});

test('expired shares remain visible for seven days without reporting a download', async () => {
  const share = await runtime.uploadSmall();
  await runtime.sql('UPDATE stored_shares SET expires_at = ? WHERE share_id = ?', [Date.now() - 1, share.share_id]);
  assert.equal((await (await status(share)).json()).state, 'expired');
  assert.equal((await (await status(share)).json()).downloaded_at, null);
  await runtime.sql('UPDATE stored_shares SET expires_at = ? WHERE share_id = ?', [Date.now() - 7 * 86400_000 - 1, share.share_id]);
  assert.equal((await status(share)).status, 404);
  await runtime.request('/_test/cleanup');
  const [row] = await runtime.sql('SELECT download_status_token_hash, downloaded_at FROM stored_shares WHERE share_id = ?', [share.share_id]);
  assert.equal(row.download_status_token_hash, '');
  assert.equal(row.downloaded_at, null);
});
