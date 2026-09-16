import {
  startOfUtcDay,
  weekWindowStart,
  type QuotaUsage,
} from './auth-limits';

export type { QuotaCheck, QuotaUsage } from './auth-limits';
export { evaluateQuota, startOfUtcDay, weekWindowStart, DAILY_QUOTA_BYTES, WEEKLY_QUOTA_BYTES } from './auth-limits';

// An uploading share is its own reservation, including uploads begun in an older window.
export const QUOTA_TOTAL_SQL = `
  (SELECT COALESCE(SUM(plaintext_bytes), 0) FROM usage_events
   WHERE account_id = ? AND created_at >= ?)
  + (SELECT COALESCE(SUM(plaintext_size), 0) FROM stored_shares
     WHERE account_id = ? AND state = 'uploading')`;

export async function loadQuotaUsage(
  db: D1Database,
  accountId: string,
  nowMs: number = Date.now(),
): Promise<QuotaUsage> {
  const dayStart = startOfUtcDay(nowMs);
  const weekStart = weekWindowStart(nowMs);

  const dayRow = await db
    .prepare(
      `SELECT (${QUOTA_TOTAL_SQL}) AS total`,
    )
    .bind(accountId, dayStart, accountId)
    .first<{ total: number }>();

  const weekRow = await db
    .prepare(
      `SELECT (${QUOTA_TOTAL_SQL}) AS total`,
    )
    .bind(accountId, weekStart, accountId)
    .first<{ total: number }>();

  return {
    day_bytes: Number(dayRow?.total ?? 0),
    week_bytes: Number(weekRow?.total ?? 0),
  };
}

export async function finalizeStoredUpload(
  db: D1Database,
  shareId: string,
  uploadToken: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const results = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO usage_events (share_id, account_id, plaintext_bytes, created_at)
       SELECT share_id, account_id, plaintext_size, ? FROM stored_shares
       WHERE share_id = ? AND state = 'uploading' AND upload_token = ?
         AND account_id IS NOT NULL AND expires_at > ?`,
    ).bind(nowMs, shareId, uploadToken, nowMs),
    db.prepare(
      `UPDATE stored_shares SET state = 'ready', upload_token = ''
       WHERE share_id = ? AND state = 'uploading' AND upload_token = ? AND expires_at > ?`,
    ).bind(shareId, uploadToken, nowMs),
  ]);
  return results[1].meta.changes === 1;
}
