import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ErrorMsg,
  accessDenied,
  shareExpired,
  userMessage,
} from './api-errors.ts';

test('accessDenied returns 403 with canonical message', async () => {
  const res = accessDenied();
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: ErrorMsg.ACCESS_DENIED });
});

test('shareExpired returns 410', async () => {
  const res = shareExpired();
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), { error: ErrorMsg.SHARE_EXPIRED });
});

test('userMessage maps known API errors', () => {
  assert.equal(userMessage({ error: 'share expired' }), ErrorMsg.SHARE_EXPIRED);
  assert.equal(userMessage({ error: 'access denied' }), ErrorMsg.ACCESS_DENIED);
  assert.equal(userMessage({}), ErrorMsg.ACCESS_DENIED);
});
