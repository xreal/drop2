/** User-facing error messages aligned with worker api-errors.ts */
export const UserMsg = {
  ACCESS_DENIED: 'Access denied',
  SHARE_EXPIRED: 'This share has expired',
  SHARE_UNAVAILABLE: 'This share is no longer available',
  SHARE_NOT_READY: 'This share is not ready yet',
  PIN_REQUIRED: 'PIN required',
  MISSING_CAPABILITY: 'Missing capability secret — use the full link from the sender',
  INVALID_CAPABILITY: 'Invalid share link — use the full link from the sender',
  CONNECTION_FAILED: 'Connection failed',
  TRANSFER_INCOMPLETE: 'Transfer incomplete',
  DOWNLOAD_FAILED: 'Download failed',
};

export function mapApiError(body) {
  if (!body || typeof body !== 'object') return UserMsg.ACCESS_DENIED;
  const msg = body.error;
  if (msg === 'share expired') return UserMsg.SHARE_EXPIRED;
  if (msg === 'share unavailable') return UserMsg.SHARE_UNAVAILABLE;
  if (msg === 'share not ready') return UserMsg.SHARE_NOT_READY;
  if (msg === 'access denied') return UserMsg.ACCESS_DENIED;
  if (typeof msg === 'string' && msg.length > 0) return msg;
  return UserMsg.ACCESS_DENIED;
}
