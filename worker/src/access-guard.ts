import { hashIp } from './ip-hash';

const COOLDOWN_MS = 15 * 60 * 1000;
const MAX_CROSS_SHARE_FAILURES = 20;
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

interface IpAbuseRow {
  ip_hash: string;
  failure_count: number;
  cooldown_until: number;
  updated_at: number;
}

export interface AccessGuardEnv {
  DB: D1Database;
}

/** Returns a denial response when the IP is globally cooled down. */
export async function globalIpBlocked(
  env: AccessGuardEnv,
  request: Request,
): Promise<boolean> {
  const ipKey = await hashIp(clientIpFrom(request));
  const row = await env.DB.prepare(
    'SELECT cooldown_until FROM ip_abuse WHERE ip_hash = ?',
  )
    .bind(ipKey)
    .first<{ cooldown_until: number }>();

  return row !== null && row.cooldown_until > Date.now();
}

/** Record a failed access attempt for cross-share IP throttling. */
export async function recordGlobalAccessFailure(
  env: AccessGuardEnv,
  request: Request,
): Promise<void> {
  const ipKey = await hashIp(clientIpFrom(request));
  const now = Date.now();

  const row = await env.DB.prepare(
    'SELECT failure_count, cooldown_until FROM ip_abuse WHERE ip_hash = ?',
  )
    .bind(ipKey)
    .first<IpAbuseRow>();

  const failures = (row?.failure_count ?? 0) + 1;
  const cooldownUntil =
    failures >= MAX_CROSS_SHARE_FAILURES ? now + COOLDOWN_MS : (row?.cooldown_until ?? 0);

  await env.DB.prepare(
    `INSERT INTO ip_abuse (ip_hash, failure_count, cooldown_until, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip_hash) DO UPDATE SET
       failure_count = excluded.failure_count,
       cooldown_until = excluded.cooldown_until,
       updated_at = excluded.updated_at`,
  )
    .bind(ipKey, failures, cooldownUntil, now)
    .run();
}

/** Clear cross-share failure count after successful admission. */
export async function clearGlobalAccessFailures(
  env: AccessGuardEnv,
  request: Request,
): Promise<void> {
  const ipKey = await hashIp(clientIpFrom(request));
  await env.DB.prepare('DELETE FROM ip_abuse WHERE ip_hash = ?').bind(ipKey).run();
}

/** Remove stale ip_abuse rows (idempotent cleanup helper). */
export async function pruneGlobalIpAbuse(env: AccessGuardEnv): Promise<number> {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  const result = await env.DB.prepare(
    `DELETE FROM ip_abuse
     WHERE updated_at < ? AND cooldown_until < ?`,
  )
    .bind(cutoff, Date.now())
    .run();
  return result.meta.changes ?? 0;
}

function clientIpFrom(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-shr-ip') ??
    '0.0.0.0'
  );
}

export { MAX_CROSS_SHARE_FAILURES, COOLDOWN_MS as GLOBAL_COOLDOWN_MS };
