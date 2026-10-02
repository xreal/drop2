import { b64urlDecode, b64urlEncode } from './base64url.js';

export const MAX_SECRET_BYTES = 6000;

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const PBKDF2_ITERATIONS = 600_000;
const enc = new TextEncoder();
const AAD = enc.encode('drop2.v1.secret');

/**
 * Encrypt a secret. `key` belongs in the URL fragment and nowhere else; the sender keeps
 * `linkToken` so it can destroy the link without retaining the key.
 */
export async function sealSecret(text, passphrase = '') {
  const keyBytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const material = await deriveMaterial(keyBytes, passphrase);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: AAD },
    material.encKey,
    enc.encode(text),
  );

  return {
    key: b64urlEncode(keyBytes),
    ciphertext: b64urlEncode(concat(nonce, new Uint8Array(sealed))),
    linkToken: material.linkToken,
    linkHash: await sha256Hex(material.linkToken),
    keyHash: await sha256Hex(material.keyToken),
  };
}

/** Tokens for a reveal request, plus a decryptor for the ciphertext it returns. */
export async function unlockSecret(keyBytes, passphrase = '') {
  const { linkToken, keyToken, encKey } = await deriveMaterial(keyBytes, passphrase);
  return { linkToken, keyToken, open: (ciphertext) => decrypt(encKey, ciphertext) };
}

/** Proves possession of the full link without involving the passphrase. */
export async function linkTokenFor(keyBytes) {
  return b64urlEncode(await hkdf(keyBytes, 'drop2.v1.secret.link', KEY_BYTES));
}

export function parseKey(fragment) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(fragment)) return null;
  return b64urlDecode(fragment);
}

export function byteLength(text) {
  return enc.encode(text).length;
}

async function deriveMaterial(keyBytes, passphrase) {
  const ikm = passphrase ? concat(keyBytes, await stretch(keyBytes, passphrase)) : keyBytes;
  const encKey = await crypto.subtle.importKey(
    'raw',
    await hkdf(ikm, 'drop2.v1.secret.key', KEY_BYTES),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
  return {
    linkToken: await linkTokenFor(keyBytes),
    keyToken: b64urlEncode(await hkdf(ikm, 'drop2.v1.secret.auth', KEY_BYTES)),
    encKey,
  };
}

async function decrypt(encKey, ciphertext) {
  const bytes = b64urlDecode(ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, NONCE_BYTES), additionalData: AAD },
    encKey,
    bytes.subarray(NONCE_BYTES),
  );
  return new TextDecoder().decode(plain);
}

async function stretch(keyBytes, passphrase) {
  const salt = await hkdf(keyBytes, 'drop2.v1.secret.pass-salt', 16);
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function hkdf(ikm, info, length) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: enc.encode(info) },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
