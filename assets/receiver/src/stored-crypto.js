import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import {
  appendEncryptedFrames,
  createFrameState,
  finalizeEncryptedFrames,
} from './frame-stream.js';
import { mapApiError, UserMsg } from './errors.js';

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function deriveManifestKey(capabilityBytes) {
  return hkdf(
    sha256,
    capabilityBytes,
    undefined,
    enc.encode('drop2.v1.stored.manifest-key'),
    32,
  );
}

export function generateStoredMaterial() {
  const capabilityBytes = crypto.getRandomValues(new Uint8Array(32));
  const dek = crypto.getRandomValues(new Uint8Array(32));
  return {
    capabilityBytes,
    capability: b64urlEncode(capabilityBytes),
    dek,
  };
}

function deriveContentDek(encodedDek) {
  return b64urlDecode(encodedDek);
}

export function parseCapabilityFragment(fragment, expectedLength) {
  if (!fragment) return null;
  let bytes;
  try {
    bytes = b64urlDecode(fragment);
  } catch {
    return null;
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    return null;
  }
  return bytes;
}

export function decryptStoredManifest(ciphertext, capabilityBytes) {
  if (ciphertext.length < 24 + 16) {
    throw new Error('Invalid manifest');
  }
  const key = deriveManifestKey(capabilityBytes);
  const nonce = ciphertext.subarray(0, 24);
  const body = ciphertext.subarray(24);
  const aead = xchacha20poly1305(key, nonce, enc.encode('drop2.v1.stored.manifest'));
  const plain = aead.decrypt(body);
  const manifest = JSON.parse(new TextDecoder().decode(plain));
  if (manifest.v !== 1) {
    throw new Error('Unsupported manifest version');
  }
  return manifest;
}

export function encryptStoredManifest(manifest, capabilityBytes) {
  const key = deriveManifestKey(capabilityBytes);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const aead = xchacha20poly1305(key, nonce, enc.encode('drop2.v1.stored.manifest'));
  const plain = enc.encode(JSON.stringify(manifest));
  const body = aead.encrypt(plain);
  const out = new Uint8Array(nonce.length + body.length);
  out.set(nonce, 0);
  out.set(body, nonce.length);
  return out;
}

export async function downloadStoredShare({
  shareId,
  capabilityBytes,
  info,
  onProgress,
  onStatus,
}) {
  onStatus('Verifying access…');

  const accessBody = {};
  if (info.pin_required) {
    const pin = prompt('Enter 4-digit PIN');
    if (!pin) throw new Error(UserMsg.PIN_REQUIRED);
    accessBody.pin = pin;
  }

  const accessRes = await fetch(`/api/v1/stored/${shareId}/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(accessBody),
  });
  if (!accessRes.ok) {
    const err = await accessRes.json().catch(() => ({}));
    throw new Error(mapApiError(err));
  }
  const access = await accessRes.json();

  onStatus('Fetching encrypted manifest…');

  const manifestRes = await fetch(`/api/v1/stored/${shareId}/manifest`, {
    headers: { 'x-drop2-download-token': access.download_token },
  });
  if (!manifestRes.ok) {
    throw new Error('Could not fetch manifest');
  }
  const manifestBytes = new Uint8Array(await manifestRes.arrayBuffer());
  const manifest = decryptStoredManifest(manifestBytes, capabilityBytes);
  const contentKey = deriveContentDek(manifest.content_dek);

  onStatus('Downloading encrypted chunks…');

  const state = createFrameState();
  for (let index = 1; index <= access.chunk_count; index += 1) {
    const chunkRes = await fetch(`/api/v1/stored/${shareId}/chunks/${index}`, {
      headers: { 'x-drop2-download-token': access.download_token },
    });
    if (!chunkRes.ok) {
      throw new Error(`Chunk ${index} unavailable`);
    }
    const chunkBytes = new Uint8Array(await chunkRes.arrayBuffer());
    onProgress(appendEncryptedFrames(state, chunkBytes, contentKey));
  }

  const plaintext = finalizeEncryptedFrames(state, {
    expectedBytes: manifest.plaintext_size,
  });

  fetch(`/api/v1/stored/${shareId}/download-complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-drop2-download-token': access.download_token,
    },
    body: JSON.stringify({ bytes_received: plaintext.length }),
  }).catch((err) => console.warn('download-complete failed', err));

  return plaintext;
}
