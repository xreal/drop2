import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUICK_MANIFEST_MAX_BYTES,
  validPlaintextStorageSize,
  validStoredPolicy,
} from './stored-policy.ts';

test('plaintext storage requires the quick-link policy', () => {
  assert.equal(validStoredPolicy('none', 'quick', 20, 'pin-hash', 'file'), true);
  assert.equal(validStoredPolicy('none', '1d', 20, 'pin-hash', 'file'), false);
  assert.equal(validStoredPolicy('none', 'quick', 1, 'pin-hash', 'file'), false);
  assert.equal(validStoredPolicy('none', 'quick', 20, '', 'file'), false);
  assert.equal(validStoredPolicy('none', 'quick', 20, 'pin-hash', 'folder'), false);
});

test('encrypted storage cannot opt into the quick-link expiry', () => {
  assert.equal(validStoredPolicy('end_to_end', '1w', 20, '', 'file'), true);
  assert.equal(validStoredPolicy('end_to_end', 'quick', 1, 'pin-hash', 'file'), false);
});

test('plaintext storage bytes must match the declared file size', () => {
  assert.equal(validPlaintextStorageSize('none', 10, 100, 110), true);
  assert.equal(validPlaintextStorageSize('none', 10, 100, 111), false);
  assert.equal(
    validPlaintextStorageSize('none', 10, QUICK_MANIFEST_MAX_BYTES + 1, 10),
    false,
  );
  assert.equal(validPlaintextStorageSize('end_to_end', 10, 100, 999), true);
});
