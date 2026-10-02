const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HOUR_MS = 60 * 60 * 1000;

export const MAX_SECRET_BYTES = 6000;
export const MAX_FAILED_ATTEMPTS = 5;

const MIN_CIPHERTEXT_BYTES = NONCE_BYTES + TAG_BYTES + 1;
const MAX_CIPHERTEXT_BYTES = NONCE_BYTES + MAX_SECRET_BYTES + TAG_BYTES;
const EXPIRY_MS: Record<string, number> = { '1h': HOUR_MS, '1d': 24 * HOUR_MS, '1w': 7 * 24 * HOUR_MS };

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export interface NewSecret {
  ciphertext: string;
  linkHash: string;
  keyHash: string;
  passphrase: boolean;
  ttlMs: number;
}

/** Validate a create request; anything unexpected is rejected rather than coerced. */
export function parseNewSecret(body: Record<string, unknown>): NewSecret | null {
  const { ciphertext, link_hash, key_hash, passphrase, expires_in } = body;
  if (!isCiphertext(ciphertext)) return null;
  if (!isSha256Hex(link_hash) || !isSha256Hex(key_hash)) return null;
  if (typeof passphrase !== 'boolean') return null;
  if (typeof expires_in !== 'string' || !Object.hasOwn(EXPIRY_MS, expires_in)) return null;

  return { ciphertext, linkHash: link_hash, keyHash: key_hash, passphrase, ttlMs: EXPIRY_MS[expires_in] };
}

/** A 32-byte token, base64url without padding. */
export function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_RE.test(value);
}

function isCiphertext(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE64URL_RE.test(value) || value.length % 4 === 1) return false;
  const bytes = Math.floor((value.length * 3) / 4);
  return bytes >= MIN_CIPHERTEXT_BYTES && bytes <= MAX_CIPHERTEXT_BYTES;
}
