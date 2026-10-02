import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRuntime } from '../test/runtime.mjs';
import { parseNewSecret } from './secret-policy.ts';

const token = () => randomBytes(32).toString('base64url');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const ciphertext = randomBytes(64).toString('base64url');

let runtime;
before(async () => { runtime = await createRuntime(); });
after(async () => { await runtime?.mf.dispose(); });

async function createSecret({ passphrase = false, ip = '192.0.2.50', expires_in = '1d' } = {}) {
  const link_token = token();
  const key_token = token();
  const response = await runtime.request('/api/v1/secrets', {
    ciphertext, link_hash: sha256(link_token), key_hash: sha256(key_token), passphrase, expires_in,
  }, { headers: { 'cf-connecting-ip': ip } });
  assert.equal(response.status, 200, await response.clone().text());
  const { id, expires_at } = await response.json();
  return { id, expires_at, link_token, key_token, base: `/api/v1/secrets/${id}` };
}

test('a secret can be revealed exactly once, even under concurrent reveals', async () => {
  const secret = await createSecret();
  const reveals = await Promise.all(Array.from({ length: 8 }, () =>
    runtime.request(`${secret.base}/reveal`, { link_token: secret.link_token, key_token: secret.key_token })));

  const succeeded = reveals.filter((response) => response.status === 200);
  assert.equal(succeeded.length, 1);
  assert.deepEqual(await succeeded[0].json(), { ciphertext });
  assert.ok(reveals.every((response) => response.headers.get('cache-control') === 'no-store'));
  assert.deepEqual(await runtime.sql('SELECT id FROM secrets WHERE id = ?', [secret.id]), []);
});

test('status needs the link token and reports the passphrase requirement', async () => {
  const secret = await createSecret({ passphrase: true });

  const status = await runtime.request(`${secret.base}/status`, { link_token: secret.link_token });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { passphrase: true, expires_at: secret.expires_at });

  const stranger = await runtime.request(`${secret.base}/status`, { link_token: token() });
  assert.equal(stranger.status, 404);
});

test('knowing only the id can neither reveal nor burn a secret', async () => {
  const secret = await createSecret();
  for (let i = 0; i < 10; i += 1) {
    const response = await runtime.request(`${secret.base}/reveal`, { link_token: token(), key_token: token() });
    assert.equal(response.status, 404);
  }
  const destroy = await runtime.request(secret.base, { link_token: token() }, { method: 'DELETE' });
  assert.equal(destroy.status, 404);

  const [row] = await runtime.sql('SELECT failed_attempts FROM secrets WHERE id = ?', [secret.id]);
  assert.equal(row.failed_attempts, 0);
});

test('five wrong passphrases destroy the secret', async () => {
  const secret = await createSecret({ passphrase: true });
  const guess = () => runtime.request(`${secret.base}/reveal`, { link_token: secret.link_token, key_token: token() });

  for (let left = 4; left >= 1; left -= 1) {
    const response = await guess();
    assert.equal(response.status, 403);
    assert.equal((await response.json()).attempts_left, left);
  }
  assert.equal((await guess()).status, 404);

  const correct = await runtime.request(`${secret.base}/reveal`, { link_token: secret.link_token, key_token: secret.key_token });
  assert.equal(correct.status, 404);
  assert.deepEqual(await runtime.sql('SELECT id FROM secrets WHERE id = ?', [secret.id]), []);
});

test('concurrent wrong passphrases cannot outrun the attempt limit', async () => {
  const secret = await createSecret({ passphrase: true });
  await Promise.all(Array.from({ length: 20 }, () =>
    runtime.request(`${secret.base}/reveal`, { link_token: secret.link_token, key_token: token() })));

  const correct = await runtime.request(`${secret.base}/reveal`, { link_token: secret.link_token, key_token: secret.key_token });
  assert.equal(correct.status, 404);
});

test('link holders can destroy a secret before it is read', async () => {
  const secret = await createSecret();
  const destroy = await runtime.request(secret.base, { link_token: secret.link_token }, { method: 'DELETE' });
  assert.equal(destroy.status, 204);

  const reveal = await runtime.request(`${secret.base}/reveal`, { link_token: secret.link_token, key_token: secret.key_token });
  assert.equal(reveal.status, 404);
});

test('expired secrets are unavailable and removed by cleanup', async () => {
  const secret = await createSecret({ expires_in: '1h' });
  await runtime.sql('UPDATE secrets SET expires_at = ? WHERE id = ?', [Date.now() - 1, secret.id]);

  const reveal = await runtime.request(`${secret.base}/reveal`, { link_token: secret.link_token, key_token: secret.key_token });
  assert.equal(reveal.status, 404);

  assert.equal((await runtime.request('/_test/cleanup')).status, 200);
  assert.deepEqual(await runtime.sql('SELECT id FROM secrets WHERE id = ?', [secret.id]), []);
});

test('secret creation is rate limited per client', async () => {
  const ip = '192.0.2.60';
  for (let i = 0; i < 30; i += 1) await createSecret({ ip });
  const response = await runtime.request('/api/v1/secrets', {
    ciphertext, link_hash: sha256(token()), key_hash: sha256(token()), passphrase: false, expires_in: '1d',
  }, { headers: { 'cf-connecting-ip': ip } });
  assert.equal(response.status, 429);
});

test('create requests reject malformed or oversized input', () => {
  const valid = { ciphertext, link_hash: sha256('a'), key_hash: sha256('b'), passphrase: false, expires_in: '1w' };
  assert.equal(parseNewSecret(valid).ttlMs, 7 * 24 * 60 * 60 * 1000);

  const invalid = [
    { expires_in: '30d' },
    { expires_in: 'toString' },
    { passphrase: 'yes' },
    { link_hash: 'ABC' },
    { ciphertext: 'not base64url!' },
    { ciphertext: randomBytes(20).toString('base64url') },
    { ciphertext: randomBytes(6029).toString('base64url') },
  ];
  for (const override of invalid) {
    assert.equal(parseNewSecret({ ...valid, ...override }), null, JSON.stringify(override));
  }
  assert.ok(parseNewSecret({ ...valid, ciphertext: randomBytes(6028).toString('base64url') }));
});
