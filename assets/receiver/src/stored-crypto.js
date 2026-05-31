import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import {
  appendEncryptedFrames,
  createFrameState,
  finalizeEncryptedFrames,
} from './frame-stream.js';

const enc = new TextEncoder();

function b64urlDecode(str) {
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
    enc.encode('shr.v1.stored.manifest-key'),
    32,
  );
}

function deriveContentDek(encodedDek) {
  return b64urlDecode(encodedDek);
}

export function parseCapabilityFragment(fragment) {
  if (!fragment) return null;
  try {
    return b64urlDecode(fragment);
  } catch {
    return null;
  }
}

export function decryptStoredManifest(ciphertext, capabilityBytes) {
  if (ciphertext.length < 24 + 16) {
    throw new Error('Invalid manifest');
  }
  const key = deriveManifestKey(capabilityBytes);
  const nonce = ciphertext.subarray(0, 24);
  const body = ciphertext.subarray(24);
  const aead = xchacha20poly1305(key, nonce, enc.encode('shr.v1.stored.manifest'));
  const plain = aead.decrypt(body);
  const manifest = JSON.parse(new TextDecoder().decode(plain));
  if (manifest.v !== 1) {
    throw new Error('Unsupported manifest version');
  }
  return manifest;
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
    if (!pin) throw new Error('PIN required');
    accessBody.pin = pin;
  }

  const accessRes = await fetch(`/api/v1/stored/${shareId}/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(accessBody),
  });
  if (!accessRes.ok) {
    const err = await accessRes.json().catch(() => ({}));
    throw new Error(err.error || 'Access denied');
  }
  const access = await accessRes.json();

  onStatus('Fetching encrypted manifest…');

  const manifestRes = await fetch(`/api/v1/stored/${shareId}/manifest`, {
    headers: { 'x-shr-download-token': access.download_token },
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
      headers: { 'x-shr-download-token': access.download_token },
    });
    if (!chunkRes.ok) {
      throw new Error(`Chunk ${index} unavailable`);
    }
    const chunkBytes = new Uint8Array(await chunkRes.arrayBuffer());
    onProgress(appendEncryptedFrames(state, chunkBytes, contentKey));
  }

  return finalizeEncryptedFrames(state, {
    expectedBytes: manifest.plaintext_size,
  });
}
