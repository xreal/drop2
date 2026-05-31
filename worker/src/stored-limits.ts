export const MAX_CHUNK_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const CHUNK_CIPHERTEXT_OVERHEAD_BYTES = 20;

export function maxChunkCiphertextSizeForRow(chunkPlaintextSize: number): number {
  return chunkPlaintextSize + CHUNK_CIPHERTEXT_OVERHEAD_BYTES;
}

export function maxChunkCiphertextBytes(
  totalDataCiphertext: number,
  chunkCount: number,
  index: number,
): number {
  const remainingChunks = chunkCount - index;
  const minOtherBytes = remainingChunks;
  const max = totalDataCiphertext - minOtherBytes;
  return Math.max(1, max);
}

export function exceedsCiphertextBudget(
  uploadedBefore: number,
  existingForIndex: number,
  incomingSize: number,
  dataCiphertextBudget: number,
): boolean {
  const uploadedAfter = uploadedBefore - existingForIndex + incomingSize;
  return uploadedAfter > dataCiphertextBudget;
}

export function validateReadyTotals(
  uploadedChunkCount: number,
  expectedChunkCount: number,
  uploadedDataCiphertextBytes: number,
  expectedDataCiphertextBytes: number,
): 'missing_chunks' | 'ciphertext_total_mismatch' | null {
  if (uploadedChunkCount !== expectedChunkCount) {
    return 'missing_chunks';
  }
  if (uploadedDataCiphertextBytes !== expectedDataCiphertextBytes) {
    return 'ciphertext_total_mismatch';
  }
  return null;
}
