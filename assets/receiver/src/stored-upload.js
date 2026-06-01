import { encryptFrame } from './frame-stream.js';
import {
  b64urlEncode,
  encryptStoredManifest,
  generateStoredMaterial,
} from './stored-crypto.js';
import { generatePin, hashPin } from './pin.js';

export const STORED_CHUNK_PLAINTEXT_SIZE = 8 * 1024 * 1024;
export const ANONYMOUS_BROWSER_SEND_LIMIT = 10 * 1024 * 1024;

export async function prepareStoredUpload(file, { expiryMode = '1w', onProgress } = {}) {
  if (file.size > ANONYMOUS_BROWSER_SEND_LIMIT) {
    throw new Error('Anonymous browser sends are limited to 10 MiB for now.');
  }

  const material = generateStoredMaterial();
  const pin = generatePin();
  const pinMaterial = hashPin(pin);
  const chunks = [];
  let ciphertextBytesTotal = 0;
  let readBytes = 0;
  let index = 0;

  for (let offset = 0; offset < file.size; offset += STORED_CHUNK_PLAINTEXT_SIZE) {
    const slice = file.slice(offset, offset + STORED_CHUNK_PLAINTEXT_SIZE);
    const plain = new Uint8Array(await slice.arrayBuffer());
    const encrypted = encryptFrame(plain, material.dek, index);
    chunks.push(encrypted);
    ciphertextBytesTotal += encrypted.length;
    readBytes += plain.length;
    index += 1;
    onProgress?.({ phase: 'encrypt', done: readBytes, total: file.size });
  }

  if (file.size === 0) {
    throw new Error('Empty files are not supported yet.');
  }

  const manifest = {
    v: 1,
    kind: 'file',
    display_name: file.name || 'download',
    plaintext_size: file.size,
    chunk_count: chunks.length,
    chunk_plaintext_size: STORED_CHUNK_PLAINTEXT_SIZE,
    content_dek: b64urlEncode(material.dek),
  };
  const encryptedManifest = encryptStoredManifest(manifest, material.capabilityBytes);
  ciphertextBytesTotal += encryptedManifest.length;

  return {
    fileName: manifest.display_name,
    size: file.size,
    expiryMode,
    pin,
    capability: material.capability,
    manifest: encryptedManifest,
    chunks,
    createBody: {
      kind: 'file',
      name: manifest.display_name,
      size: file.size,
      expiry_mode: expiryMode,
      max_downloads: 20,
      ...pinMaterial,
      chunk_count: chunks.length,
      chunk_plaintext_size: STORED_CHUNK_PLAINTEXT_SIZE,
      manifest_ciphertext_bytes: encryptedManifest.length,
      ciphertext_bytes_total: ciphertextBytesTotal,
    },
  };
}

export async function uploadPreparedStoredShare(prepared, { onProgress } = {}) {
  const createRes = await fetch('/api/v1/stored', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prepared.createBody),
  });
  if (!createRes.ok) throw new Error(await apiErrorMessage(createRes));
  const create = await createRes.json();

  await putBytes(
    `/api/v1/stored/${create.share_id}/manifest`,
    create.upload_token,
    prepared.manifest,
  );
  onProgress?.({ phase: 'upload', done: 1, total: prepared.chunks.length + 1 });

  for (let i = 0; i < prepared.chunks.length; i += 1) {
    await putBytes(
      `/api/v1/stored/${create.share_id}/chunks/${i + 1}`,
      create.upload_token,
      prepared.chunks[i],
    );
    onProgress?.({ phase: 'upload', done: i + 2, total: prepared.chunks.length + 1 });
  }

  const completeRes = await fetch(`/api/v1/stored/${create.share_id}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upload_token: create.upload_token }),
  });
  if (!completeRes.ok) throw new Error(await apiErrorMessage(completeRes));

  return {
    ...create,
    share_url: `${create.share_url_base}#${prepared.capability}`,
    pin: prepared.pin,
  };
}

async function putBytes(url, uploadToken, bytes) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-drop2-upload-token': uploadToken,
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
}

async function apiErrorMessage(res) {
  const body = await res.json().catch(() => null);
  return body?.message || body?.error || `Request failed (${res.status})`;
}
