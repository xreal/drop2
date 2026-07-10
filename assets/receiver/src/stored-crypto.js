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
  const encrypted = info.encryption_mode !== 'none';
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

  onStatus(encrypted ? 'Fetching encrypted manifest…' : 'Fetching file details…');

  const manifestRes = await fetch(`/api/v1/stored/${shareId}/manifest`, {
    headers: { 'x-drop2-download-token': access.download_token },
  });
  if (!manifestRes.ok) {
    throw new Error('Could not fetch manifest');
  }
  const manifestBytes = new Uint8Array(await manifestRes.arrayBuffer());
  const manifest = encrypted
    ? decryptStoredManifest(manifestBytes, capabilityBytes)
    : parsePlaintextManifest(manifestBytes);
  validateManifest(manifest, access);
  const contentKey = encrypted ? deriveContentDek(manifest.content_dek) : null;

  onStatus(encrypted ? 'Downloading encrypted chunks…' : 'Downloading file…');

  const state = encrypted ? createFrameState() : null;
  const plainChunks = [];
  let receivedBytes = 0;
  for (let index = 1; index <= access.chunk_count; index += 1) {
    const chunkRes = await fetch(`/api/v1/stored/${shareId}/chunks/${index}`, {
      headers: { 'x-drop2-download-token': access.download_token },
    });
    if (!chunkRes.ok) {
      throw new Error(`Chunk ${index} unavailable`);
    }
    const chunkBytes = new Uint8Array(await chunkRes.arrayBuffer());
    if (encrypted) {
      onProgress(appendEncryptedFrames(state, chunkBytes, contentKey));
    } else {
      plainChunks.push(chunkBytes);
      receivedBytes += chunkBytes.length;
      onProgress(receivedBytes);
    }
  }

  const plaintext = encrypted
    ? finalizeEncryptedFrames(state, { expectedBytes: manifest.plaintext_size })
    : joinPlaintextChunks(plainChunks, manifest.plaintext_size);

  return {
    bytes: plaintext,
    complete: () => completeDownload(shareId, access.download_token, plaintext.length),
  };
}

async function completeDownload(shareId, downloadToken, bytesReceived) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`/api/v1/stored/${shareId}/download-complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-drop2-download-token': downloadToken,
      },
      body: JSON.stringify({ bytes_received: bytesReceived }),
    }).catch(() => null);
    if (response?.ok) return true;
  }
  return false;
}

export function parsePlaintextManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Invalid file manifest');
  }
  if (manifest?.v !== 1 || manifest.encryption_mode !== 'none') {
    throw new Error('Invalid file manifest');
  }
  return manifest;
}

function validateManifest(manifest, access) {
  if (
    !Number.isSafeInteger(manifest.plaintext_size) ||
    manifest.plaintext_size !== access.size ||
    manifest.chunk_count !== access.chunk_count ||
    manifest.display_name !== access.name
  ) {
    throw new Error('File details do not match');
  }
}

function joinPlaintextChunks(chunks, expectedBytes) {
  const received = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (received !== expectedBytes) {
    throw new Error('Transfer incomplete');
  }
  const plaintext = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    plaintext.set(chunk, offset);
    offset += chunk.length;
  }
  return plaintext;
}
