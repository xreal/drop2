export type StoredEncryptionMode = 'end_to_end' | 'none';
export const QUICK_MANIFEST_MAX_BYTES = 64 * 1024;

export function validStoredPolicy(
  encryptionMode: StoredEncryptionMode,
  expiryMode: string,
  maxDownloads: number,
  pinHash: string,
  kind: string,
): boolean {
  if (encryptionMode === 'none') {
    return expiryMode === 'quick' && maxDownloads === 20 && pinHash.length > 0 && kind === 'file';
  }
  return expiryMode !== 'quick';
}

export function validPlaintextStorageSize(
  encryptionMode: StoredEncryptionMode,
  plaintextSize: number,
  manifestBytes: number,
  storedBytesTotal: number,
): boolean {
  return (
    encryptionMode !== 'none' ||
    (manifestBytes <= QUICK_MANIFEST_MAX_BYTES && storedBytesTotal - manifestBytes === plaintextSize)
  );
}
