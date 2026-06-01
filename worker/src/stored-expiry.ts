export const MAX_EXPIRES_SECONDS = 30 * 24 * 60 * 60;

export interface ExpiryInput {
  expires_seconds?: number;
  expiry_mode?: string;
}

export interface ResolvedExpiry {
  mode: string;
  expiresSeconds: number;
  deleteAfterComplete: boolean;
}

export function resolveExpiry(body: ExpiryInput): ResolvedExpiry | null {
  if (body.expiry_mode === undefined) {
    if (!isExpiresSeconds(body.expires_seconds)) return null;
    return {
      mode: 'legacy',
      expiresSeconds: body.expires_seconds,
      deleteAfterComplete: false,
    };
  }
  switch (body.expiry_mode) {
    case 'after_download':
      return {
        mode: body.expiry_mode,
        expiresSeconds: MAX_EXPIRES_SECONDS,
        deleteAfterComplete: true,
      };
    case '1d':
      return { mode: body.expiry_mode, expiresSeconds: 86_400, deleteAfterComplete: false };
    case '2d':
      return { mode: body.expiry_mode, expiresSeconds: 172_800, deleteAfterComplete: false };
    case '1w':
      return { mode: body.expiry_mode, expiresSeconds: 604_800, deleteAfterComplete: false };
    default:
      return null;
  }
}

function isExpiresSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 60 &&
    value <= MAX_EXPIRES_SECONDS
  );
}
