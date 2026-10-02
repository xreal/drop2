const BASE62 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// Largest multiple of 62 below 256, so rejection sampling keeps every character equally likely.
const UNBIASED_LIMIT = 248;
const SHARE_ID_LENGTH = 6;
const SECRET_ID_LENGTH = 12;

export function generateShareId(): string {
  return randomBase62(SHARE_ID_LENGTH);
}

export function isValidShareId(id: string): boolean {
  return isBase62(id, SHARE_ID_LENGTH);
}

export function generateSecretId(): string {
  return randomBase62(SECRET_ID_LENGTH);
}

export function isValidSecretId(id: string): boolean {
  return isBase62(id, SECRET_ID_LENGTH);
}

function randomBase62(length: number): string {
  let id = '';
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < UNBIASED_LIMIT && id.length < length) id += BASE62[byte % 62];
    }
  }
  return id;
}

function isBase62(id: string, length: number): boolean {
  return id.length === length && [...id].every((c) => BASE62.includes(c));
}
