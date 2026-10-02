import { hashIp, clientIp } from './ip-hash';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PRUNE_AFTER_MS = 2 * DAY_MS;

export interface IpQuota {
  scope: string;
  hourly: number;
  daily: number;
}

export const EMAIL_QUOTA: IpQuota = { scope: 'email', hourly: 10, daily: 25 };
export const SECRET_QUOTA: IpQuota = { scope: 'secret', hourly: 30, daily: 200 };

interface QuotaEnv {
  DB: D1Database;
}

/** Reserve `amount` units against the hourly and daily budget of the client IP. */
export async function reserveIpQuota(
  env: QuotaEnv,
  request: Request,
  quota: IpQuota,
  amount = 1,
): Promise<boolean> {
  const ipHash = await hashIp(clientIp(request));
  const now = Date.now();
  const hourBucket = `${quota.scope}:h:${Math.floor(now / HOUR_MS)}`;
  const dayBucket = `${quota.scope}:d:${Math.floor(now / DAY_MS)}`;

  if (!(await reserveBucket(env, ipHash, hourBucket, amount, quota.hourly, now))) {
    return false;
  }
  if (await reserveBucket(env, ipHash, dayBucket, amount, quota.daily, now)) {
    return true;
  }

  await refundBucket(env, ipHash, hourBucket, amount);
  return false;
}

export async function pruneIpQuotas(env: QuotaEnv): Promise<void> {
  await env.DB.prepare('DELETE FROM ip_quotas WHERE updated_at < ?')
    .bind(Date.now() - PRUNE_AFTER_MS)
    .run();
}

async function reserveBucket(
  env: QuotaEnv,
  ipHash: string,
  bucket: string,
  amount: number,
  limit: number,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT INTO ip_quotas (ip_hash, bucket, message_count, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip_hash, bucket) DO UPDATE SET
       message_count = message_count + excluded.message_count,
       updated_at = excluded.updated_at
     WHERE message_count + excluded.message_count <= ?`,
  )
    .bind(ipHash, bucket, amount, now, limit)
    .run();
  return result.meta.changes === 1;
}

async function refundBucket(
  env: QuotaEnv,
  ipHash: string,
  bucket: string,
  amount: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE ip_quotas
     SET message_count = MAX(0, message_count - ?)
     WHERE ip_hash = ? AND bucket = ?`,
  )
    .bind(amount, ipHash, bucket)
    .run();
}
