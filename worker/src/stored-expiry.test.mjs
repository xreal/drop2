import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExpiry, MAX_EXPIRES_SECONDS } from './stored-expiry.ts';

test('resolveExpiry accepts expiry_mode without expires_seconds', () => {
  assert.deepEqual(resolveExpiry({ expiry_mode: '1w' }), {
    mode: '1w',
    expiresSeconds: 604_800,
    deleteAfterComplete: false,
  });
});

test('resolveExpiry maps after_download to delete_after_complete', () => {
  const r = resolveExpiry({ expiry_mode: 'after_download' });
  assert.equal(r.mode, 'after_download');
  assert.equal(r.deleteAfterComplete, true);
  assert.equal(r.expiresSeconds, MAX_EXPIRES_SECONDS);
});

test('resolveExpiry maps 1d and 2d to relative seconds', () => {
  assert.equal(resolveExpiry({ expiry_mode: '1d' }).expiresSeconds, 86_400);
  assert.equal(resolveExpiry({ expiry_mode: '2d' }).expiresSeconds, 172_800);
});

test('resolveExpiry rejects unknown expiry_mode', () => {
  assert.equal(resolveExpiry({ expiry_mode: 'forever' }), null);
});

test('resolveExpiry falls back to expires_seconds when mode is absent', () => {
  assert.deepEqual(resolveExpiry({ expires_seconds: 3600 }), {
    mode: 'legacy',
    expiresSeconds: 3600,
    deleteAfterComplete: false,
  });
});

test('resolveExpiry rejects when both mode and expires_seconds are missing', () => {
  assert.equal(resolveExpiry({}), null);
});

test('resolveExpiry rejects expires_seconds out of range', () => {
  assert.equal(resolveExpiry({ expires_seconds: 30 }), null);
  assert.equal(resolveExpiry({ expires_seconds: MAX_EXPIRES_SECONDS + 1 }), null);
});
