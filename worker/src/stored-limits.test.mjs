import test from 'node:test';
import assert from 'node:assert/strict';

import {
  exceedsCiphertextBudget,
  maxChunkCiphertextBytes,
  maxChunkCiphertextSizeForRow,
  validateReadyTotals,
} from './stored-limits.ts';

test('maxChunkCiphertextSizeForRow adds protocol overhead', () => {
  assert.equal(maxChunkCiphertextSizeForRow(1024), 1044);
});

test('maxChunkCiphertextBytes reserves minimum bytes for remaining chunks', () => {
  assert.equal(maxChunkCiphertextBytes(100, 3, 1), 98);
  assert.equal(maxChunkCiphertextBytes(100, 3, 3), 100);
});

test('exceedsCiphertextBudget detects over-budget replacement', () => {
  assert.equal(exceedsCiphertextBudget(60, 10, 15, 65), false);
  assert.equal(exceedsCiphertextBudget(60, 10, 16, 65), true);
});

test('validateReadyTotals catches missing chunks and total mismatch', () => {
  assert.equal(validateReadyTotals(1, 2, 30, 30), 'missing_chunks');
  assert.equal(
    validateReadyTotals(2, 2, 29, 30),
    'ciphertext_total_mismatch',
  );
  assert.equal(validateReadyTotals(2, 2, 30, 30), null);
});
