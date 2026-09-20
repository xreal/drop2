import { downloadDetails } from './download-details';
import { hashToken } from './token-proof';
import type { ShareKind, StoredShareStatus } from './protocol';
import { verifyPin, pinRequired, validPinMaterial } from './pin';
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
import {
  reservePinAttempt,
  releasePinAttempt,
  type AccessGuardEnv,
} from './access-guard';
import {
  validStoredLayout,
  storedChunkBytes,
  MAX_MANIFEST_BYTES,
  validateReadyTotals,
} from './stored-limits';
import { resolveExpiry } from './stored-expiry';
import {
  validStoredPolicy,
  type StoredEncryptionMode,
} from './stored-policy';
import { createEmailNotifyProof } from './email-notify';
import { evaluateBrowserSendSize } from './auth-limits';
import {
  evaluateQuota, loadQuotaUsage, finalizeStoredUpload, QUOTA_TOTAL_SQL,
  startOfUtcDay, weekWindowStart, DAILY_QUOTA_BYTES, WEEKLY_QUOTA_BYTES,
} from './auth-quota';
import { resolveSession } from './auth-session';
import { readBoundedBytes, readJsonObject } from './request-body';

const DOWNLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_DOWNLOADS = 20;

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
  download_count: number;
  last_access_at: number | null;
  expiry_mode: string;
  max_downloads: number;
  delete_after_complete: number;
  encryption_mode: StoredEncryptionMode;
  email_notify_token_hash: string;
  email_recipient_count: number;
  account_id: string | null;
}

export interface CreateStoredBody {
  kind: ShareKind;
  name: string;
  size: number;
  expires_seconds?: number;
  pin_salt: string;
  pin_hash: string;
  chunk_count: number;
  chunk_plaintext_size: number;
  manifest_ciphertext_bytes: number;
  ciphertext_bytes_total: number;
  expiry_mode?: string;
  max_downloads?: number;
  encryption_mode?: string;
}

export async function createStoredShare(
  env: StoredShareEnv,
  body: CreateStoredBody,
  origin: string,
  request?: Request,
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
  if (
    typeof body.pin_salt !== 'string' ||
    typeof body.pin_hash !== 'string'
  ) {
    return jsonError('invalid pin material', 400);
  }
  if (!validPinMaterial(body.pin_salt, body.pin_hash)) {
    return jsonError('invalid pin material', 400);
  }
  if (!validStoredLayout(body)) return jsonError('invalid storage layout', 400);

  const expiry = resolveExpiry(body);
  if (!expiry) {
    return jsonError('invalid expiry', 400);
  }
  const maxDownloads = body.max_downloads ?? DEFAULT_MAX_DOWNLOADS;
  if (
    !Number.isInteger(maxDownloads) ||
    maxDownloads < 1 ||
    maxDownloads > DEFAULT_MAX_DOWNLOADS
  ) {
    return jsonError('invalid max downloads', 400);
  }
  const encryptionMode = body.encryption_mode ?? 'end_to_end';
  if (
    (encryptionMode !== 'end_to_end' && encryptionMode !== 'none') ||
    !validStoredPolicy(
      encryptionMode,
      expiry.mode,
      maxDownloads,
      body.pin_hash,
      body.kind,
    )
  ) {
    return jsonError('invalid storage policy', 400);
  }
  const session = request ? await resolveSession(env.DB, request) : null;
  let quota = null;
  if (session && session.account.eligible === 1) {
    const usage = await loadQuotaUsage(env.DB, session.account.account_id);
    quota = evaluateQuota(usage, body.size);
  }
  const gate = evaluateBrowserSendSize(
    body.size,
    session
      ? {
          signedIn: true,
          eligible: session.account.eligible === 1,
          suspended: session.account.status === 'suspended',
          accountId: session.account.account_id,
          quota,
        }
      : null,
  );
  if (!gate.allow) {
    return Response.json(
      {
        error: gate.error,
        message: gate.message,
        ...(gate.limits ? { limits: gate.limits } : {}),
        ...(gate.quota ? { quota: gate.quota } : {}),
      },
      { status: gate.status },
    );
  }
  const accountId = gate.accountId;

  const shareId = generateShareId();
  const storagePrefix = crypto.randomUUID();
  const uploadToken = crypto.randomUUID();
  const emailNotify = await createEmailNotifyProof();
  const statusToken = crypto.randomUUID();
  const statusTokenHash = await hashToken(statusToken);
  const now = Date.now();
  const expiresAt = now + expiry.expiresSeconds * 1000;
  const manifestKey = objectKey(
    storagePrefix,
    encryptionMode === 'none' ? 'manifest.json' : 'manifest.enc',
  );

  const created = await env.DB.prepare(
    `INSERT INTO stored_shares (
      share_id, storage_prefix, state, created_at, expires_at,
      pin_salt, pin_hash, item_kind, display_name, plaintext_size,
      manifest_object_key, chunk_count, chunk_plaintext_size,
      manifest_ciphertext_bytes, ciphertext_bytes_total, upload_token,
      expiry_mode, max_downloads, delete_after_complete, encryption_mode,
      email_notify_token_hash, account_id, download_status_token_hash
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? IS NULL OR (
        (${QUOTA_TOTAL_SQL}) + ? <= ? AND (${QUOTA_TOTAL_SQL}) + ? <= ?
      )`,
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
      expiry.mode,
      maxDownloads,
      expiry.deleteAfterComplete ? 1 : 0,
      encryptionMode,
      emailNotify.hash,
      accountId,
      statusTokenHash,
      accountId,
      accountId, startOfUtcDay(now), accountId, body.size, DAILY_QUOTA_BYTES,
      accountId, weekWindowStart(now), accountId, body.size, WEEKLY_QUOTA_BYTES,
    )
    .run();

  if (created.meta.changes !== 1) return jsonError('quota_exceeded', 403);

  return Response.json({
    share_id: shareId,
    share_url_base: `${origin}/s/${shareId}`,
    storage_prefix: storagePrefix,
    upload_token: uploadToken,
    email_notify_token: emailNotify.token,
    download_status_token: statusToken,
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
    expiry_mode: row.expiry_mode,
    downloads_remaining: Math.max(0, row.max_downloads - row.download_count),
    encryption_mode: row.encryption_mode,
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
  const reusableQuickToken =
    row.encryption_mode === 'none' ? activeDownloadToken(row, Date.now()) : null;
  if (row.download_count >= row.max_downloads && !reusableQuickToken) {
    return jsonError('download limit reached', 403, {
      code: 'download_limit_reached',
    });
  }

  const body = await readJsonObject(request);
  if (!body) return jsonError(ErrorMsg.INVALID_REQUEST, 400);

  if (pinRequired(row.pin_hash)) {
    const reservation = await reservePinAttempt(env, request, shareId);
    if (!reservation) return accessDenied();
    const pin = body?.pin;
    if (typeof pin !== 'string') return accessDenied();
    const ok = await verifyPin(pin, row.pin_salt, row.pin_hash);
    if (!ok) return accessDenied();
    await releasePinAttempt(env, reservation);
  }

  const now = Date.now();
  let downloadToken = row.encryption_mode === 'none' ? activeDownloadToken(row, now) : null;
  if (downloadToken) {
    await env.DB.prepare(
      `UPDATE stored_shares
       SET last_access_at = ?
       WHERE share_id = ? AND state = 'ready' AND download_token = ?`,
    )
      .bind(
        now,
        shareId,
        downloadToken,
      )
      .run();
  } else {
    downloadToken = crypto.randomUUID();
    const tokenExpires = now + DOWNLOAD_TOKEN_TTL_MS;
    const quickTokenGuard =
      row.encryption_mode === 'none'
        ? ' AND (download_token IS NULL OR download_token_expires_at IS NULL OR download_token_expires_at < ?)'
        : '';
    const statement = env.DB.prepare(
      `UPDATE stored_shares
       SET download_token = ?, download_token_expires_at = ?,
            download_count = download_count + 1, last_access_at = ?
       WHERE share_id = ? AND state = 'ready'
         AND download_count < max_downloads AND expires_at > ?${quickTokenGuard}`,
    );
    const admission = row.encryption_mode === 'none'
      ? await statement
          .bind(
            downloadToken,
            tokenExpires,
            now,
            shareId,
            now,
            now,
          )
          .run()
      : await statement
          .bind(
            downloadToken,
            tokenExpires,
            now,
            shareId,
            now,
          )
          .run();
    if (admission.meta.changes !== 1) {
      const concurrent = await fetchRow(env, shareId);
      const concurrentToken =
        concurrent?.encryption_mode === 'none'
          ? activeDownloadToken(concurrent, Date.now())
          : null;
      if (!concurrentToken) {
        return jsonError('download limit reached', 403, {
          code: 'download_limit_reached',
        });
      }
      downloadToken = concurrentToken;
    }
  }

  return Response.json({
    download_token: downloadToken,
    kind: row.item_kind,
    name: row.display_name,
    size: row.plaintext_size,
    chunk_count: row.chunk_count,
    status: 'ready',
    encryption_mode: row.encryption_mode,
  });
}

export async function completeStoredDownload(
  env: StoredShareEnv,
  shareId: string,
  request: Request,
): Promise<Response> {
  const row = await fetchRow(env, shareId);
  if (!row) return shareUnavailable();
  if (isExpired(row)) return shareExpired();
  if (row.state === 'deleted') {
    return Response.json({ ok: true });
  }
  if (row.state === 'deleting') {
    await finishStoredDeletion(env, row);
    return Response.json({ ok: true });
  }
  if (row.state !== 'ready') return shareNotReady();
  if (!verifyDownloadToken(request, row)) {
    return unauthorized();
  }

  const body = await readJsonObject(request);
  if (!body || !Number.isSafeInteger(body.bytes_received) || body.bytes_received !== row.plaintext_size) {
    return jsonError('download size mismatch', 400);
  }

  const now = Date.now();
  const details = downloadDetails(request);
  const completion = await env.DB.prepare(
    `UPDATE stored_shares
     SET downloaded_at = COALESCE(downloaded_at, ?),
         download_country = CASE WHEN downloaded_at IS NULL THEN ? ELSE download_country END,
         download_region = CASE WHEN downloaded_at IS NULL THEN ? ELSE download_region END,
         download_network = CASE WHEN downloaded_at IS NULL THEN ? ELSE download_network END,
         download_asn = CASE WHEN downloaded_at IS NULL THEN ? ELSE download_asn END,
         state = CASE WHEN delete_after_complete = 1 THEN 'deleting' ELSE state END
     WHERE share_id = ? AND state = 'ready' AND download_token = ?
       AND download_token_expires_at >= ? AND expires_at > ?`,
  ).bind(now, details.country, details.region, details.network, details.asn,
    shareId, row.download_token, now, now).run();
  if (completion.meta.changes !== 1) {
    const current = await fetchRow(env, shareId);
    if (!current || !['deleting', 'deleted'].includes(current.state)) return unauthorized();
  }
  if (row.delete_after_complete === 1) await finishStoredDeletion(env, row);

  return Response.json({ ok: true });
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

  const body = await readBoundedBytes(request, Math.min(row.manifest_ciphertext_bytes, MAX_MANIFEST_BYTES));
  if (!body || body.byteLength !== row.manifest_ciphertext_bytes) {
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

  const expectedBytes = storedChunkBytes(row.plaintext_size, row.chunk_plaintext_size, index, row.encryption_mode !== 'none');
  const body = await readBoundedBytes(request, expectedBytes);
  if (!body || body.byteLength !== expectedBytes) return jsonError('chunk size mismatch', 400);

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

  const body = await readJsonObject(request);
  if (!body) return jsonError(ErrorMsg.INVALID_REQUEST, 400);
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

  if (!(await finalizeStoredUpload(env.DB, shareId, row.upload_token))) return accessDenied();

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

function activeDownloadToken(row: StoredRow, now: number): string | null {
  if (
    !row.download_token ||
    !row.download_token_expires_at ||
    row.download_token_expires_at < now
  ) {
    return null;
  }
  return row.download_token;
}

function isExpired(row: StoredRow): boolean {
  return row.expires_at <= Date.now();
}

function publicStatus(row: StoredRow): StoredShareStatus {
  if (isExpired(row)) return 'expired';
  if (row.state === 'ready') return 'ready';
  if (row.state === 'uploading') return 'uploading';
  if (row.state === 'deleted') return 'deleted';
  if (row.state === 'failed') return 'failed';
  return 'expired';
}

async function deleteStoredObjects(env: StoredShareEnv, row: StoredRow): Promise<void> {
  await env.STORED.delete(row.manifest_object_key);
  for (let index = 1; index <= row.chunk_count; index += 1) {
    await env.STORED.delete(objectKey(row.storage_prefix, chunkName(index)));
  }
}

async function finishStoredDeletion(env: StoredShareEnv, row: StoredRow): Promise<void> {
  await deleteStoredObjects(env, row);
  await env.DB.prepare(
    `UPDATE stored_shares SET state = 'deleted', download_token = NULL,
     download_token_expires_at = NULL WHERE share_id = ?`,
  )
    .bind(row.share_id)
    .run();
}

async function summarizeUploadedChunks(
  env: StoredShareEnv,
  prefix: string,
): Promise<{
  chunk_count: number;
  total_bytes: number;
}> {
  let chunkCount = 0;
  let totalBytes = 0;
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
    }

    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return {
    chunk_count: chunkCount,
    total_bytes: totalBytes,
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
