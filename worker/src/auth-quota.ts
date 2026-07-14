import {
  evaluateQuota,
  startOfUtcDay,
  weekWindowStart,
  type QuotaUsage,
} from './auth-limits';

export type { QuotaCheck, QuotaUsage } from './auth-limits';
export { evaluateQuota, startOfUtcDay } from './auth-limits';

export async function loadQuotaUsage(
  db: D1Database,
  accountId: string,
  nowMs: number = Date.now(),
): Promise<QuotaUsage> {
  const dayStart = startOfUtcDay(nowMs);
  const weekStart = weekWindowStart(nowMs);

  const dayRow = await db
    .prepare(
      `SELECT COALESCE(SUM(plaintext_bytes), 0) AS total
       FROM usage_events
       WHERE account_id = ? AND created_at >= ?`,
    )
    .bind(accountId, dayStart)
    .first<{ total: number }>();

  const weekRow = await db
    .prepare(
      `SELECT COALESCE(SUM(plaintext_bytes), 0) AS total
       FROM usage_events
       WHERE account_id = ? AND created_at >= ?`,
    )
    .bind(accountId, weekStart)
    .first<{ total: number }>();

  return {
    day_bytes: Number(dayRow?.total ?? 0),
    week_bytes: Number(weekRow?.total ?? 0),
  };
}

export async function recordUsageEvent(
  db: D1Database,
  accountId: string,
  shareId: string,
  plaintextBytes: number,
  nowMs: number = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO usage_events (share_id, account_id, plaintext_bytes, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(shareId, accountId, plaintextBytes, nowMs)
    .run();
}
