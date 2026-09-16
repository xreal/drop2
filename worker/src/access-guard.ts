import { hashIp } from './ip-hash';

const COOLDOWN_MS = 15 * 60 * 1000;
const MAX_CROSS_SHARE_FAILURES = 20;
const MAX_SHARE_FAILURES = 3;

export interface AccessGuardEnv {
  DB: D1Database;
}

interface Reservation {
  scope: string;
  window: number;
}

/** Reserve capacity before verification, including concurrent requests in the budget. */
export async function reservePinAttempt(
  env: AccessGuardEnv,
  request: Request,
  shareId: string,
): Promise<Reservation[] | null> {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-drop2-ip') ?? '0.0.0.0';
  const ipKey = await hashIp(ip);
  const global = await reserve(env, `global:${ipKey}`, MAX_CROSS_SHARE_FAILURES);
  if (!global) return null;
  const share = await reserve(env, `share:${shareId}:${ipKey}`, MAX_SHARE_FAILURES);
  if (!share) {
    await releasePinAttempt(env, [global]);
    return null;
  }
  return [global, share];
}

async function reserve(env: AccessGuardEnv, scope: string, limit: number): Promise<Reservation | null> {
  const now = Date.now();
  const cutoff = now - COOLDOWN_MS;
  const row = await env.DB.prepare(
    `INSERT INTO pin_attempts (scope, attempts, window_start) VALUES (?, 1, ?)
     ON CONFLICT(scope) DO UPDATE SET
       attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
       window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
     WHERE window_start <= ? OR attempts < ?
     RETURNING window_start`,
  ).bind(scope, now, cutoff, cutoff, cutoff, limit).first<{ window_start: number }>();
  return row ? { scope, window: row.window_start } : null;
}

/** Refund only this successful attempt; never erase other failures or a newer window. */
export async function releasePinAttempt(env: AccessGuardEnv, reservations: Reservation[]): Promise<void> {
  await env.DB.batch(reservations.map(({ scope, window }) => env.DB.prepare(
    'UPDATE pin_attempts SET attempts = MAX(0, attempts - 1) WHERE scope = ? AND window_start = ?',
  ).bind(scope, window)));
}

export async function pruneGlobalIpAbuse(env: AccessGuardEnv): Promise<number> {
  const result = await env.DB.prepare('DELETE FROM pin_attempts WHERE window_start < ?')
    .bind(Date.now() - 24 * 60 * 60 * 1000).run();
  return result.meta.changes ?? 0;
}

export { MAX_CROSS_SHARE_FAILURES, COOLDOWN_MS as GLOBAL_COOLDOWN_MS };
