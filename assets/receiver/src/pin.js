import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { b64urlEncode } from './stored-crypto.js';

const ITERATIONS = 100_000;

export function generatePin() {
  const value = crypto.getRandomValues(new Uint16Array(1))[0] % 10_000;
  return String(value).padStart(4, '0');
}

export function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = pbkdf2(sha256, new TextEncoder().encode(pin), salt, {
    c: ITERATIONS,
    dkLen: 32,
  });
  return {
    pin_salt: b64urlEncode(salt),
    pin_hash: b64urlEncode(hash),
  };
}
