import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, pin, storedBody } from '../test/runtime.mjs';

let runtime;
before(async () => { runtime = await createRuntime(); });
after(async () => { await runtime?.mf.dispose(); });

test('32 concurrent wrong PINs cannot bypass the three-attempt limit', async () => {
  const share = await runtime.uploadSmall(storedBody(4, {
    encryption_mode: 'none', expiry_mode: 'quick', ciphertext_bytes_total: 5,
  }));
  const options = {headers:{'cf-connecting-ip':'192.0.2.10'}};
  const results = await Promise.all(Array.from({length:32}, () =>
    runtime.request(share.base + '/access', {pin:'0000'}, options)));
  assert.ok(results.every(response => response.status === 403));
  const [counter] = await runtime.sql('SELECT attempts FROM pin_attempts WHERE scope LIKE ?', [`share:${share.share_id}:%`]);
  assert.equal(counter.attempts, 3);
  assert.equal((await runtime.request(share.base + '/access', {pin}, options)).status, 403);

  await runtime.sql('UPDATE pin_attempts SET window_start = ?', [Date.now() - 15 * 60 * 1000 - 1]);
  assert.equal((await runtime.request(share.base + '/access', {pin}, options)).status, 200);
});

test('successful access cannot clear failures accumulated against other shares', async () => {
  const victim = await runtime.uploadSmall();
  const own = await runtime.uploadSmall();
  const options = {headers:{'cf-connecting-ip':'192.0.2.20'}};
  for (let i = 0; i < 2; i += 1) {
    assert.equal((await runtime.request(victim.base + '/access', {pin:'0000'}, options)).status, 403);
  }
  const before = await runtime.sql("SELECT scope, attempts FROM pin_attempts WHERE scope LIKE 'global:%' ORDER BY scope");
  assert.equal((await runtime.request(own.base + '/access', {pin}, options)).status, 200);
  assert.deepEqual(await runtime.sql("SELECT scope, attempts FROM pin_attempts WHERE scope LIKE 'global:%' ORDER BY scope"), before);
});

test('global reservations bound parallel PIN guessing across shares', async () => {
  const shares = await Promise.all(Array.from({length:8}, () => runtime.uploadSmall()));
  const options = {headers:{'cf-connecting-ip':'192.0.2.30'}};
  await Promise.all(shares.flatMap(share => Array.from({length:3}, () =>
    runtime.request(share.base + '/access', {pin:'0000'}, options))));
  const ids = shares.map(share => `share:${share.share_id}:%`);
  const rows = await runtime.sql(`SELECT SUM(attempts) AS attempts FROM pin_attempts WHERE ${ids.map(() => 'scope LIKE ?').join(' OR ')}`, ids);
  assert.equal(rows[0].attempts, 20);
  const own = await runtime.uploadSmall();
  assert.equal((await runtime.request(own.base + '/access', {pin}, options)).status, 403);
});
