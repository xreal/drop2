import { jsonError, ErrorMsg } from './api-errors';
import { reserveIpQuota, SECRET_QUOTA } from './ip-quota';
import { readJsonObject } from './request-body';
import { isToken, MAX_FAILED_ATTEMPTS, parseNewSecret } from './secret-policy';
import { generateSecretId } from './share-id';
import { hashToken } from './token-proof';

interface SecretEnv {
  DB: D1Database;
}

export async function createSecret(env: SecretEnv, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  const secret = body && parseNewSecret(body);
  if (!secret) return jsonError(ErrorMsg.INVALID_REQUEST, 400);
  if (!(await reserveIpQuota(env, request, SECRET_QUOTA))) {
    return jsonError('rate limit reached', 429);
  }

  const id = generateSecretId();
  const now = Date.now();
  const expiresAt = now + secret.ttlMs;
  await env.DB.prepare(
    `INSERT INTO secrets (id, ciphertext, link_hash, key_hash, passphrase, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, secret.ciphertext, secret.linkHash, secret.keyHash, secret.passphrase ? 1 : 0, now, expiresAt)
    .run();

  return Response.json({ id, expires_at: expiresAt });
}

export async function secretStatus(env: SecretEnv, id: string, request: Request): Promise<Response> {
  const linkHash = await readTokenHash(request, 'link_token');
  if (!linkHash) return jsonError(ErrorMsg.INVALID_REQUEST, 400);

  const row = await env.DB.prepare(
    'SELECT passphrase, expires_at FROM secrets WHERE id = ? AND link_hash = ? AND expires_at > ?',
  )
    .bind(id, linkHash, Date.now())
    .first<{ passphrase: number; expires_at: number }>();
  if (!row) return secretUnavailable();

  return Response.json({ passphrase: row.passphrase === 1, expires_at: row.expires_at });
}

/** Release the ciphertext exactly once; a single DELETE … RETURNING makes concurrent reveals race-free. */
export async function revealSecret(env: SecretEnv, id: string, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body || !isToken(body.link_token) || !isToken(body.key_token)) {
    return jsonError(ErrorMsg.INVALID_REQUEST, 400);
  }
  const linkHash = await hashToken(body.link_token);
  const keyHash = await hashToken(body.key_token);
  const now = Date.now();

  const revealed = await env.DB.prepare(
    `DELETE FROM secrets
     WHERE id = ? AND link_hash = ? AND key_hash = ? AND expires_at > ? AND failed_attempts < ?
     RETURNING ciphertext`,
  )
    .bind(id, linkHash, keyHash, now, MAX_FAILED_ATTEMPTS)
    .first<{ ciphertext: string }>();
  if (revealed) return Response.json({ ciphertext: revealed.ciphertext });

  return recordFailedAttempt(env, id, linkHash, now);
}

/** Only link holders reach this point, so guessing ids can never burn someone else's secret. */
async function recordFailedAttempt(env: SecretEnv, id: string, linkHash: string, now: number): Promise<Response> {
  const row = await env.DB.prepare(
    `UPDATE secrets SET failed_attempts = failed_attempts + 1
     WHERE id = ? AND link_hash = ? AND expires_at > ? AND failed_attempts < ?
     RETURNING failed_attempts`,
  )
    .bind(id, linkHash, now, MAX_FAILED_ATTEMPTS)
    .first<{ failed_attempts: number }>();
  if (!row) return secretUnavailable();

  const attemptsLeft = MAX_FAILED_ATTEMPTS - row.failed_attempts;
  if (attemptsLeft === 0) {
    await env.DB.prepare('DELETE FROM secrets WHERE id = ?').bind(id).run();
    return secretUnavailable();
  }
  return jsonError(ErrorMsg.ACCESS_DENIED, 403, { attempts_left: attemptsLeft });
}

export async function destroySecret(env: SecretEnv, id: string, request: Request): Promise<Response> {
  const linkHash = await readTokenHash(request, 'link_token');
  if (!linkHash) return jsonError(ErrorMsg.INVALID_REQUEST, 400);

  const result = await env.DB.prepare('DELETE FROM secrets WHERE id = ? AND link_hash = ?')
    .bind(id, linkHash)
    .run();
  return result.meta.changes === 1 ? new Response(null, { status: 204 }) : secretUnavailable();
}

export async function pruneExpiredSecrets(env: SecretEnv): Promise<void> {
  await env.DB.prepare('DELETE FROM secrets WHERE expires_at <= ?').bind(Date.now()).run();
}

async function readTokenHash(request: Request, field: string): Promise<string | null> {
  const body = await readJsonObject(request);
  const token = body?.[field];
  return isToken(token) ? hashToken(token) : null;
}

function secretUnavailable(): Response {
  return jsonError('secret unavailable', 404);
}
