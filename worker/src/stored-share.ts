import type { ShareKind, StoredShareStatus } from './protocol';
import { verifyPin, pinRequired, validPinMaterial } from './pin';
import { pruneAbuseTracking, recordFailedPin } from './abuse-tracking';
import { generateShareId, isValidShareId } from './share-id';
import {
  accessDenied,
  shareExpired,
  shareUnavailable,
  shareNotReady,
  unauthorized,
  jsonError,
  ErrorMsg,
} from './api-errors';
import { hashIp, clientIp } from './ip-hash';
import {
  clearGlobalAccessFailures,
  globalIpBlocked,
  recordGlobalAccessFailure,
  type AccessGuardEnv,
} from './access-guard';
import {
  exceedsCiphertextBudget,
  maxChunkCiphertextBytes as calcMaxChunkCiphertextBytes,
  maxChunkCiphertextSizeForRow as calcMaxChunkCiphertextSizeForRow,
  MAX_CHUNK_PLAINTEXT_BYTES,
  validateReadyTotals,
} from './stored-limits';

const COOLDOWN_MS = 15 * 60 * 1000;
const MAX_PIN_FAILURES = 3;
const DOWNLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_EXPIRES_SECONDS = 30 * 24 * 60 * 60;

export interface StoredShareEnv extends AccessGuardEnv {
  DB: D1Database;
  STORED: R2Bucket;
}

interface StoredRow {
  share_id: string;
  storage_prefix: string;
  state: string;
  created_at: number;
  expires_at: number;
  pin_salt: string;
  pin_hash: string;
  item_kind: string;
  display_name: string;
  plaintext_size: number;
  manifest_object_key: string;
  chunk_count: number;
  chunk_plaintext_size: number;
  manifest_ciphertext_bytes: number;
  ciphertext_bytes_total: number;
  upload_token: string;
  download_token: string | null;
  download_token_expires_at: number | null;
  failed_pins: string;
  cooldown_until: string;
  download_count: number;
  last_access_at: number | null;
}

export interface CreateStoredBody {
  kind: ShareKind;
  name: string;
  size: number;
  expires_seconds: number;
  pin_salt: string;
  pin_hash: string;
  chunk_count: number;
  chunk_plaintext_size: number;
  manifest_ciphertext_bytes: number;
  ciphertext_bytes_total: number;
}

export async function createStoredShare(
  env: StoredShareEnv,
  body: CreateStoredBody,
  origin: string,
): Promise<Response> {
  if (body.kind !== 'file' && body.kind !== 'folder') {
    return jsonError('invalid kind', 400);
  }
  if (!body.name || typeof body.name !== 'string') {
    return jsonError('invalid name', 400);
  }
  if (!isNonNegativeSafeInteger(body.size)) {
    return jsonError('invalid size', 400);
  }
  if (!isExpiresSeconds(body.expires_seconds)) {
    return jsonError('invalid expiry', 400);
  }
  if (
    typeof body.pin_salt !== 'string' ||
    typeof body.pin_hash !== 'string'
  ) {
    return jsonError('invalid pin material', 400);
  }
  if (!validPinMaterial(body.pin_salt, body.pin_hash)) {
    return jsonError('invalid pin material', 400);
  }
  if (
    !Number.isInteger(body.chunk_count) ||
    body.chunk_count < 1 ||
    body.chunk_count > 10_000
  ) {
    return jsonError('invalid chunk count', 400);
  }
  if (
    !Number.isInteger(body.chunk_plaintext_size) ||
    body.chunk_plaintext_size < 1 ||
    body.chunk_plaintext_size > MAX_CHUNK_PLAINTEXT_BYTES
  ) {
    return jsonError('invalid chunk size', 400);
  }
  if (
    !Number.isInteger(body.manifest_ciphertext_bytes) ||
    body.manifest_ciphertext_bytes < 1
  ) {
    return jsonError('invalid manifest size', 400);
  }
  if (
    !Number.isInteger(body.ciphertext_bytes_total) ||
    body.ciphertext_bytes_total < body.manifest_ciphertext_bytes
  ) {
    return jsonError('invalid ciphertext total', 400);
  }

  const shareId = generateShareId();
  const storagePrefix = crypto.randomUUID();
  const uploadToken = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + body.expires_seconds * 1000;
  const manifestKey = objectKey(storagePrefix, 'manifest.enc');

  await env.DB.prepare(
    `INSERT INTO stored_shares (
      share_id, storage_prefix, state, created_at, expires_at,
      pin_salt, pin_hash, item_kind, display_name, plaintext_size,
      manifest_object_key, chunk_count, chunk_plaintext_size,
      manifest_ciphertext_bytes, ciphertext_bytes_total, upload_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      shareId,
      storagePrefix,
      'uploading',
      now,
      expiresAt,
      body.pin_salt,
      body.pin_hash,
      body.kind,
      body.name,
      body.size,
      manifestKey,
      body.chunk_count,
      body.chunk_plaintext_size,
      body.manifest_ciphertext_bytes,
      body.ciphertext_bytes_total,
      uploadToken,
    )
    .run();

  return Response.json({
    share_id: shareId,
    share_url_base: `${origin}/s/${shareId}`,
    storage_prefix: storagePrefix,
    upload_token: uploadToken,
    expires_at: expiresAt,
  });
}

export async function getStoredShareInfo(
  env: StoredShareEnv,
  shareId: string,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row) return shareUnavailable();
  if (isExpired(row)) {
    return shareExpired();
  }

  return Response.json({
    share_id: row.share_id,
    mode: 'stored',
    kind: row.item_kind,
    name: row.display_name,
    size: row.plaintext_size,
    pin_required: pinRequired(row.pin_hash),
    status: publicStatus(row),
    expires_at: row.expires_at,
  });
}

export async function accessStoredShare(
  env: StoredShareEnv,
  shareId: string,
  request: Request,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row) return accessDenied();
  if (isExpired(row)) return shareExpired();
  if (row.state !== 'ready') {
    return shareNotReady();
  }

  if (await globalIpBlocked(env, request)) {
    return accessDenied();
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(ErrorMsg.INVALID_REQUEST, 400);
  }

  const ipKey = await hashIp(clientIp(request));
  const abuse = parseAbuse(row);

  if (abuse.cooldown_until[ipKey] && abuse.cooldown_until[ipKey] > Date.now()) {
    return accessDenied();
  }

  if (pinRequired(row.pin_hash)) {
    const pin = body.pin;
    if (typeof pin !== 'string') {
      await recordGlobalAccessFailure(env, request);
      return accessDenied();
    }
    const ok = await verifyPin(pin, row.pin_salt, row.pin_hash);
    if (!ok) {
      recordFailedPin(
        abuse,
        ipKey,
        (abuse.failed_pins[ipKey] ?? 0) + 1 >= MAX_PIN_FAILURES
          ? Date.now() + COOLDOWN_MS
          : null,
      );
      pruneAbuseTracking(abuse, Date.now());
      await saveAbuse(env, shareId, abuse);
      await recordGlobalAccessFailure(env, request);
      return accessDenied();
    }
  }

  if (abuse.failed_pins[ipKey] || abuse.cooldown_until[ipKey]) {
    delete abuse.failed_pins[ipKey];
    delete abuse.cooldown_until[ipKey];
    pruneAbuseTracking(abuse, Date.now());
  }

  await clearGlobalAccessFailures(env, request);

  const downloadToken = crypto.randomUUID();
  const tokenExpires = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  await env.DB.prepare(
    `UPDATE stored_shares
     SET download_token = ?, download_token_expires_at = ?,
         download_count = download_count + 1, last_access_at = ?,
         failed_pins = ?, cooldown_until = ?
     WHERE share_id = ?`,
  )
    .bind(
      downloadToken,
      tokenExpires,
      Date.now(),
      JSON.stringify(abuse.failed_pins),
      JSON.stringify(abuse.cooldown_until),
      shareId,
    )
    .run();

  return Response.json({
    download_token: downloadToken,
    kind: row.item_kind,
    name: row.display_name,
    size: row.plaintext_size,
    chunk_count: row.chunk_count,
    status: 'ready',
  });
}

export async function uploadManifest(
  env: StoredShareEnv,
  shareId: string,
  request: Request,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row || row.state !== 'uploading') {
    return accessDenied();
  }
  if (isExpired(row)) return shareExpired();
  if (!verifyUploadToken(request, row)) {
    return unauthorized();
  }

  const body = await request.arrayBuffer();
  if (body.byteLength !== row.manifest_ciphertext_bytes) {
    return jsonError('manifest size mismatch', 400);
  }

  await env.STORED.put(row.manifest_object_key, body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  return Response.json({ ok: true });
}

export async function uploadChunk(
  env: StoredShareEnv,
  shareId: string,
  index: number,
  request: Request,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row || row.state !== 'uploading') {
    return accessDenied();
  }
  if (isExpired(row)) return shareExpired();
  if (!verifyUploadToken(request, row)) {
    return unauthorized();
  }
  if (!Number.isInteger(index) || index < 1 || index > row.chunk_count) {
    return jsonError('invalid chunk index', 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return jsonError('empty chunk', 400);
  }
  if (body.byteLength > maxChunkCiphertextSizeForRow(row)) {
    return jsonError('chunk too large', 400);
  }

  const expectedChunkMax = maxChunkCiphertextBytes(row, index);
  if (body.byteLength > expectedChunkMax) {
    return jsonError('chunk exceeds declared ciphertext total', 400);
  }

  const uploadSummary = await summarizeUploadedChunks(env, row.storage_prefix);
  const existingForIndex = uploadSummary.bytes_by_index.get(index) ?? 0;
  const dataCiphertextBudget = row.ciphertext_bytes_total - row.manifest_ciphertext_bytes;
  if (
    exceedsCiphertextBudget(
      uploadSummary.total_bytes,
      existingForIndex,
      body.byteLength,
      dataCiphertextBudget,
    )
  ) {
    return jsonError('chunk exceeds declared ciphertext total', 400);
  }

  const key = objectKey(row.storage_prefix, chunkName(index));
  await env.STORED.put(key, body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  return Response.json({ ok: true });
}

export async function completeStoredShare(
  env: StoredShareEnv,
  shareId: string,
  request: Request,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row || row.state !== 'uploading') {
    return accessDenied();
  }
  if (isExpired(row)) return shareExpired();

  let body: { upload_token?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(ErrorMsg.INVALID_REQUEST, 400);
  }
  if (body.upload_token !== row.upload_token) {
    return unauthorized();
  }

  const manifestObject = await env.STORED.head(row.manifest_object_key);
  if (!manifestObject) {
    return jsonError('manifest missing', 400);
  }
  if (Number(manifestObject.size) !== row.manifest_ciphertext_bytes) {
    return jsonError('manifest size mismatch', 400);
  }

  const chunkSummary = await summarizeUploadedChunks(env, row.storage_prefix);
  const dataCiphertextBudget = row.ciphertext_bytes_total - row.manifest_ciphertext_bytes;
  const totalsError = validateReadyTotals(
    chunkSummary.chunk_count,
    row.chunk_count,
    chunkSummary.total_bytes,
    dataCiphertextBudget,
  );
  if (totalsError === 'missing_chunks') {
    return jsonError('missing chunks', 400);
  }
  if (totalsError === 'ciphertext_total_mismatch') {
    return jsonError('ciphertext total mismatch', 400);
  }

  await env.DB.prepare(
    `UPDATE stored_shares SET state = 'ready', upload_token = '' WHERE share_id = ?`,
  )
    .bind(shareId)
    .run();

  return Response.json({ ok: true, status: 'ready' });
}

export async function downloadManifest(
  env: StoredShareEnv,
  shareId: string,
  request: Request,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row) return shareUnavailable();
  if (isExpired(row)) return shareExpired();
  if (row.state !== 'ready') return shareNotReady();
  if (!verifyDownloadToken(request, row)) {
    return unauthorized();
  }

  const obj = await env.STORED.get(row.manifest_object_key);
  if (!obj) return shareUnavailable();

  return new Response(obj.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(row.manifest_ciphertext_bytes),
    },
  });
}

export async function downloadChunk(
  env: StoredShareEnv,
  shareId: string,
  index: number,
  request: Request,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row) return shareUnavailable();
  if (isExpired(row)) return shareExpired();
  if (row.state !== 'ready') return shareNotReady();
  if (!verifyDownloadToken(request, row)) {
    return unauthorized();
  }
  if (!Number.isInteger(index) || index < 1 || index > row.chunk_count) {
    return jsonError(ErrorMsg.INVALID_REQUEST, 400);
  }

  const key = objectKey(row.storage_prefix, chunkName(index));
  const obj = await env.STORED.get(key);
  if (!obj) return shareUnavailable();

  return new Response(obj.body, {
    headers: { 'content-type': 'application/octet-stream' },
  });
}

async function fetchRow(
  env: StoredShareEnv,
  shareId: string,
): Promise<StoredRow | null> {
  if (!isValidShareId(shareId)) return null;
  return env.DB.prepare('SELECT * FROM stored_shares WHERE share_id = ?')
    .bind(shareId)
    .first<StoredRow>();
}

function objectKey(prefix: string, name: string): string {
  return `v1/stored/${prefix}/${name}`;
}

function chunkName(index: number): string {
  return `chunk-${String(index).padStart(6, '0')}.bin`;
}

function verifyUploadToken(request: Request, row: StoredRow): boolean {
  const token = request.headers.get('x-drop2-upload-token');
  return token !== null && token === row.upload_token && row.upload_token.length > 0;
}

function verifyDownloadToken(request: Request, row: StoredRow): boolean {
  const token = request.headers.get('x-drop2-download-token');
  if (!token || !row.download_token || token !== row.download_token) {
    return false;
  }
  if (!row.download_token_expires_at || row.download_token_expires_at < Date.now()) {
    return false;
  }
  return true;
}

function isExpired(row: StoredRow): boolean {
  return row.expires_at <= Date.now();
}

function publicStatus(row: StoredRow): StoredShareStatus {
  if (isExpired(row)) return 'expired';
  if (row.state === 'ready') return 'ready';
  if (row.state === 'uploading') return 'uploading';
  if (row.state === 'failed') return 'failed';
  return 'expired';
}

function parseAbuse(row: StoredRow) {
  const failedPins = safeParseJsonRecord(row.failed_pins);
  const cooldownUntil = safeParseJsonRecord(row.cooldown_until);
  return {
    failed_pins: failedPins,
    cooldown_until: cooldownUntil,
  };
}

function safeParseJsonRecord(raw: string): Record<string, number> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
        out[key] = val;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function maxChunkCiphertextBytes(row: StoredRow, index: number): number {
  const totalDataCiphertext = row.ciphertext_bytes_total - row.manifest_ciphertext_bytes;
  return calcMaxChunkCiphertextBytes(totalDataCiphertext, row.chunk_count, index);
}

function maxChunkCiphertextSizeForRow(row: StoredRow): number {
  return calcMaxChunkCiphertextSizeForRow(row.chunk_plaintext_size);
}

async function summarizeUploadedChunks(
  env: StoredShareEnv,
  prefix: string,
): Promise<{
  chunk_count: number;
  total_bytes: number;
  bytes_by_index: Map<number, number>;
}> {
  let chunkCount = 0;
  let totalBytes = 0;
  const bytesByIndex = new Map<number, number>();
  let cursor: string | undefined;
  do {
    const listing = await env.STORED.list({
      prefix: objectKey(prefix, 'chunk-'),
      cursor,
    });

    for (const obj of listing.objects) {
      const index = parseChunkIndex(obj.key);
      if (index === null) {
        continue;
      }
      chunkCount += 1;
      totalBytes += Number(obj.size);
      bytesByIndex.set(index, Number(obj.size));
    }

    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return {
    chunk_count: chunkCount,
    total_bytes: totalBytes,
    bytes_by_index: bytesByIndex,
  };
}

function parseChunkIndex(key: string): number | null {
  const m = key.match(/\/chunk-(\d{6})\.bin$/);
  if (!m) return null;
  const index = Number(m[1]);
  if (!Number.isInteger(index) || index < 1) {
    return null;
  }
  return index;
}

async function saveAbuse(
  env: StoredShareEnv,
  shareId: string,
  abuse: { failed_pins: Record<string, number>; cooldown_until: Record<string, number> },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE stored_shares SET failed_pins = ?, cooldown_until = ? WHERE share_id = ?`,
  )
    .bind(JSON.stringify(abuse.failed_pins), JSON.stringify(abuse.cooldown_until), shareId)
    .run();
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isExpiresSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 60 &&
    value <= MAX_EXPIRES_SECONDS
  );
}
