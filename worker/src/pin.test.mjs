import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
if (!globalThis.atob) {
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');
}

import { validPinMaterial, verifyPin } from './pin.ts';

test('validPinMaterial accepts empty pair and valid encoded pair', () => {
  const salt = 'w7PKh2f_mH4EX8gM1cBU9g';
  const hash = 'JwMFm20LoYBf4Qf4Q8QTO4Q2ck3q_xRo5x0vViQ4swc';
  assert.equal(validPinMaterial('', ''), true);
  assert.equal(validPinMaterial(salt, hash), true);
});

test('validPinMaterial rejects malformed pin material', () => {
  assert.equal(validPinMaterial('', 'abc'), false);
  assert.equal(validPinMaterial('abc', ''), false);
  assert.equal(validPinMaterial('***', 'abc'), false);
  assert.equal(validPinMaterial('abcd', 'efgh'), false);
});

test('verifyPin returns false on malformed base64url without throwing', async () => {
  await assert.doesNotReject(async () => {
    const ok = await verifyPin('1234', '!!!', '###');
    assert.equal(ok, false);
  });
});
