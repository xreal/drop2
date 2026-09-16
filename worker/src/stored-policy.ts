export type StoredEncryptionMode = 'end_to_end' | 'none';

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
