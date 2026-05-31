import type { ShareKind, StoredShareStatus } from './protocol';
import { verifyPin, pinRequired } from './pin';
import { pruneAbuseTracking, recordFailedPin } from './abuse-tracking';
import { generateShareId, isValidShareId } from './share-id';

const COOLDOWN_MS = 15 * 60 * 1000;
const MAX_PIN_FAILURES = 3;
const DOWNLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_EXPIRES_SECONDS = 30 * 24 * 60 * 60;

export interface StoredShareEnv {
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
  if (
    !Number.isInteger(body.chunk_count) ||
    body.chunk_count < 1 ||
    body.chunk_count > 10_000
  ) {
    return jsonError('invalid chunk count', 400);
  }
  if (
    !Number.isInteger(body.chunk_plaintext_size) ||
    body.chunk_plaintext_size < 1
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
  if (!row) return jsonError('share unavailable', 404);
  if (isExpired(row)) {
    return shareExpiredResponse();
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
  if (!row) return jsonError('access denied', 403);
  if (isExpired(row)) return shareExpiredResponse();
  if (row.state !== 'ready') {
    return jsonError('share not ready', 409);
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid body', 400);
  }

  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const ipKey = await hashIp(ip);
  const abuse = parseAbuse(row);

  if (abuse.cooldown_until[ipKey] && abuse.cooldown_until[ipKey] > Date.now()) {
    return jsonError('access denied', 429);
  }

  if (pinRequired(row.pin_hash)) {
    const pin = body.pin;
    if (typeof pin !== 'string') {
      return jsonError('access denied', 403);
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
      return jsonError('access denied', 403);
    }
  }

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
    return jsonError('upload not allowed', 403);
  }
  if (!verifyUploadToken(request, row)) {
    return jsonError('unauthorized', 401);
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
    return jsonError('upload not allowed', 403);
  }
  if (!verifyUploadToken(request, row)) {
    return jsonError('unauthorized', 401);
  }
  if (!Number.isInteger(index) || index < 1 || index > row.chunk_count) {
    return jsonError('invalid chunk index', 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return jsonError('empty chunk', 400);
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
    return jsonError('complete not allowed', 403);
  }

  let body: { upload_token?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid body', 400);
  }
  if (body.upload_token !== row.upload_token) {
    return jsonError('unauthorized', 401);
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
  if (!row) return jsonError('not found', 404);
  if (isExpired(row)) return shareExpiredResponse();
  if (row.state !== 'ready') return jsonError('not ready', 409);
  if (!verifyDownloadToken(request, row)) {
    return jsonError('unauthorized', 401);
  }

  const obj = await env.STORED.get(row.manifest_object_key);
  if (!obj) return jsonError('not found', 404);

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
  if (!row) return jsonError('not found', 404);
  if (isExpired(row)) return shareExpiredResponse();
  if (row.state !== 'ready') return jsonError('not ready', 409);
  if (!verifyDownloadToken(request, row)) {
    return jsonError('unauthorized', 401);
  }
  if (!Number.isInteger(index) || index < 1 || index > row.chunk_count) {
    return jsonError('invalid chunk index', 400);
  }

  const key = objectKey(row.storage_prefix, chunkName(index));
  const obj = await env.STORED.get(key);
  if (!obj) return jsonError('not found', 404);

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
  const token = request.headers.get('x-shr-upload-token');
  return token !== null && token === row.upload_token && row.upload_token.length > 0;
}

function verifyDownloadToken(request: Request, row: StoredRow): boolean {
  const token = request.headers.get('x-shr-download-token');
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
  return {
    failed_pins: JSON.parse(row.failed_pins || '{}') as Record<string, number>,
    cooldown_until: JSON.parse(row.cooldown_until || '{}') as Record<
      string,
      number
    >,
  };
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

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`shr.v1.ip:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function shareExpiredResponse(): Response {
  return jsonError('share expired', 410);
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
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
