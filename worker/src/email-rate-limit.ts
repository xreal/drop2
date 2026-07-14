import { hashIp, clientIp } from './ip-hash';

const HOURLY_MESSAGE_LIMIT = 10;
const DAILY_MESSAGE_LIMIT = 25;
const PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

interface RateLimitEnv {
  DB: D1Database;
}

export async function reserveEmailMessages(
  env: RateLimitEnv,
  request: Request,
  messageCount: number,
): Promise<boolean> {
  const ipHash = await hashIp(clientIp(request));
  const now = Date.now();
  const hourBucket = `h:${Math.floor(now / (60 * 60 * 1000))}`;
  const dayBucket = `d:${Math.floor(now / (24 * 60 * 60 * 1000))}`;

  if (!(await reserveBucket(env, ipHash, hourBucket, messageCount, HOURLY_MESSAGE_LIMIT, now))) {
    return false;
  }
  if (await reserveBucket(env, ipHash, dayBucket, messageCount, DAILY_MESSAGE_LIMIT, now)) {
    return true;
  }

  await refundBucket(env, ipHash, hourBucket, messageCount);
  return false;
}

export async function pruneEmailRateLimits(env: RateLimitEnv): Promise<void> {
  await env.DB.prepare('DELETE FROM email_rate_limits WHERE updated_at < ?')
    .bind(Date.now() - PRUNE_AFTER_MS)
    .run();
}

async function reserveBucket(
  env: RateLimitEnv,
  ipHash: string,
  bucket: string,
  amount: number,
  limit: number,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT INTO email_rate_limits (ip_hash, bucket, message_count, updated_at)
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
  env: RateLimitEnv,
  ipHash: string,
  bucket: string,
  amount: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE email_rate_limits
     SET message_count = MAX(0, message_count - ?)
     WHERE ip_hash = ? AND bucket = ?`,
  )
    .bind(amount, ipHash, bucket)
    .run();
}
