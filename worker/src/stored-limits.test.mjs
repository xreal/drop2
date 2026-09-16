import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validStoredLayout,
  storedChunkBytes,
  validateReadyTotals,
} from './stored-limits.ts';

test('stored layout binds plaintext size, chunk geometry, and ciphertext bytes', () => {
  const valid = {size:10, chunk_count:2, chunk_plaintext_size:8, manifest_ciphertext_bytes:100, ciphertext_bytes_total:150};
  assert.equal(validStoredLayout(valid), true);
  for (const change of [{size:1}, {chunk_count:3}, {ciphertext_bytes_total:151}, {size:NaN}, {manifest_ciphertext_bytes:65537}]) {
    assert.equal(validStoredLayout({...valid, ...change}), false);
  }
  assert.equal(validStoredLayout({...valid, encryption_mode:'none', ciphertext_bytes_total:110}), true);
  assert.equal(validStoredLayout({...valid, size:0, chunk_count:1, ciphertext_bytes_total:120}), true);
});

test('chunk sizes include framing and the shorter final chunk', () => {
  assert.equal(storedChunkBytes(10, 8, 1, true), 28);
  assert.equal(storedChunkBytes(10, 8, 2, true), 22);
  assert.equal(storedChunkBytes(10, 8, 2, false), 2);
  assert.equal(storedChunkBytes(0, 8, 1, true), 20);
});

test('validateReadyTotals catches missing chunks and total mismatch', () => {
  assert.equal(validateReadyTotals(1, 2, 30, 30), 'missing_chunks');
  assert.equal(
    validateReadyTotals(2, 2, 29, 30),
    'ciphertext_total_mismatch',
  );
  assert.equal(validateReadyTotals(2, 2, 30, 30), null);
});
