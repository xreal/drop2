const ITERATIONS = 100_000;
const SALT_LEN = 16;
const HASH_LEN = 32;

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function derive(salt: Uint8Array, pin: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    HASH_LEN * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPin(
  pin: string,
  saltB64: string,
  hashB64: string,
): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false;
  const salt = b64urlDecode(saltB64);
  const expected = b64urlDecode(hashB64);
  if (salt.length !== SALT_LEN || expected.length !== HASH_LEN) return false;
  const actual = await derive(salt, pin);
  return constantTimeEq(actual, expected);
}

export function pinRequired(pinHash: string): boolean {
  return pinHash.length > 0;
}
