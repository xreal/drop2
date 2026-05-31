import test from 'node:test';
import assert from 'node:assert/strict';

import { hashIp } from './ip-hash.ts';

test('hashIp is stable and full-length hex', async () => {
  const a = await hashIp('203.0.113.1');
  const b = await hashIp('203.0.113.1');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('hashIp differs for different IPs', async () => {
  const a = await hashIp('203.0.113.1');
  const b = await hashIp('203.0.113.2');
  assert.notEqual(a, b);
});
