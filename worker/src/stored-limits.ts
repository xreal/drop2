export const MAX_CHUNK_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const CHUNK_CIPHERTEXT_OVERHEAD_BYTES = 20;
export const MAX_MANIFEST_BYTES = 64 * 1024;

export interface StoredLayout {
  size: number;
  chunk_count: number;
  chunk_plaintext_size: number;
  manifest_ciphertext_bytes: number;
  ciphertext_bytes_total: number;
  encryption_mode?: string;
}

export function validStoredLayout(layout: StoredLayout): boolean {
  const { size, chunk_count: count, chunk_plaintext_size: chunkSize,
    manifest_ciphertext_bytes: manifest, ciphertext_bytes_total: total } = layout;
  if (!Number.isSafeInteger(size) || size < 0 ||
      !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_PLAINTEXT_BYTES ||
      !Number.isSafeInteger(count) || count < 1 || count > 10_000 ||
      !Number.isSafeInteger(manifest) || manifest < 1 || manifest > MAX_MANIFEST_BYTES ||
      !Number.isSafeInteger(total)) return false;
  const overhead = layout.encryption_mode === 'none' ? 0 : CHUNK_CIPHERTEXT_OVERHEAD_BYTES;
  return count === Math.max(1, Math.ceil(size / chunkSize)) &&
    total === manifest + size + overhead * count;
}

export function storedChunkBytes(size: number, chunkSize: number, index: number, encrypted: boolean): number {
  const plaintext = Math.min(chunkSize, Math.max(0, size - (index - 1) * chunkSize));
  return plaintext + (encrypted ? CHUNK_CIPHERTEXT_OVERHEAD_BYTES : 0);
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
