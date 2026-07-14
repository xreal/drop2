import { encryptFrame } from './frame-stream.js';
import {
  b64urlEncode,
  encryptStoredManifest,
  generateStoredMaterial,
} from './stored-crypto.js';
import { generatePin, hashPin } from './pin.js';
import { buildStoreZip } from './zip-store.js';

export const STORED_CHUNK_PLAINTEXT_SIZE = 8 * 1024 * 1024;
export const ANONYMOUS_BROWSER_SEND_LIMIT = 10 * 1024 * 1024;
export const AUTHENTICATED_BROWSER_SEND_LIMIT = 1024 * 1024 * 1024;

/**
 * @param {Blob & { name?: string }} file
 * @param {{
 *   expiryMode?: string,
 *   pinRequired?: boolean,
 *   quickLink?: boolean,
 *   kind?: 'file' | 'folder',
 *   displayName?: string,
 *   zipEntries?: Array<{ path: string, blob: Blob }>,
 *   maxPlaintextBytes?: number,
 *   onProgress?: Function,
 * }} [options]
 */
export async function prepareStoredUpload(
  file,
  {
    expiryMode = '1w',
    pinRequired = true,
    quickLink = false,
    kind = 'file',
    displayName,
    zipEntries = null,
    maxPlaintextBytes = ANONYMOUS_BROWSER_SEND_LIMIT,
    onProgress,
  } = {},
) {
  let uploadFile = file;
  let shareKind = kind === 'folder' ? 'folder' : 'file';

  if (zipEntries?.length) {
    shareKind = 'folder';
    uploadFile = await buildStoreZip(zipEntries, {
      archiveName: displayName || file?.name || 'files.zip',
      maxBytes: maxPlaintextBytes,
      onProgress,
    });
  }

  if (quickLink && shareKind === 'folder') {
    throw new Error('Quick links are only available for single files.');
  }

  if (uploadFile.size > maxPlaintextBytes) {
    throw new Error(
      maxPlaintextBytes <= ANONYMOUS_BROWSER_SEND_LIMIT
        ? 'Anonymous browser sends are limited to 10 MiB for now.'
        : 'Browser sends are limited to 1 GiB per file.',
    );
  }

  const material = quickLink ? null : generateStoredMaterial();
  const pin = quickLink || pinRequired ? generatePin() : null;
  const pinMaterial = pin ? hashPin(pin) : { pin_salt: '', pin_hash: '' };
  const chunks = [];
  let ciphertextBytesTotal = 0;
  let readBytes = 0;
  let index = 0;

  for (let offset = 0; offset < uploadFile.size; offset += STORED_CHUNK_PLAINTEXT_SIZE) {
    const slice = uploadFile.slice(offset, offset + STORED_CHUNK_PLAINTEXT_SIZE);
    const plain = new Uint8Array(await slice.arrayBuffer());
    const stored = quickLink ? plain : encryptFrame(plain, material.dek, index);
    chunks.push(stored);
    ciphertextBytesTotal += stored.length;
    readBytes += plain.length;
    index += 1;
    onProgress?.({ phase: quickLink ? 'prepare' : 'encrypt', done: readBytes, total: uploadFile.size });
  }

  if (uploadFile.size === 0) {
    throw new Error('Empty files are not supported yet.');
  }

  const name = displayName || uploadFile.name || (shareKind === 'folder' ? 'files.zip' : 'download');
  const manifest = {
    v: 1,
    kind: shareKind,
    display_name: name,
    plaintext_size: uploadFile.size,
    chunk_count: chunks.length,
    chunk_plaintext_size: STORED_CHUNK_PLAINTEXT_SIZE,
    ...(quickLink
      ? { encryption_mode: 'none' }
      : { content_dek: b64urlEncode(material.dek) }),
  };
  const storedManifest = quickLink
    ? new TextEncoder().encode(JSON.stringify(manifest))
    : encryptStoredManifest(manifest, material.capabilityBytes);
  ciphertextBytesTotal += storedManifest.length;

  return {
    fileName: manifest.display_name,
    size: uploadFile.size,
    kind: shareKind,
    expiryMode: quickLink ? 'quick' : expiryMode,
    pin,
    capability: material?.capability ?? null,
    manifest: storedManifest,
    chunks,
    createBody: {
      kind: shareKind,
      name: manifest.display_name,
      size: uploadFile.size,
      expiry_mode: quickLink ? 'quick' : expiryMode,
      max_downloads: 20,
      encryption_mode: quickLink ? 'none' : 'end_to_end',
      ...pinMaterial,
      chunk_count: chunks.length,
      chunk_plaintext_size: STORED_CHUNK_PLAINTEXT_SIZE,
      manifest_ciphertext_bytes: storedManifest.length,
      ciphertext_bytes_total: ciphertextBytesTotal,
    },
  };
}

export async function uploadPreparedStoredShare(prepared, { onProgress } = {}) {
  const createRes = await fetch('/api/v1/stored', {
    method: 'POST',
    credentials: 'same-origin',
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
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upload_token: create.upload_token }),
  });
  if (!completeRes.ok) throw new Error(await apiErrorMessage(completeRes));

  return {
    ...create,
    share_url: prepared.capability
      ? `${create.share_url_base}#${prepared.capability}`
      : create.share_url_base,
    pin: prepared.pin,
  };
}

async function putBytes(url, uploadToken, bytes) {
  const res = await fetch(url, {
    method: 'PUT',
    credentials: 'same-origin',
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
