import { pruneGlobalIpAbuse, type AccessGuardEnv } from './access-guard';

const UPLOAD_STALE_MS = 24 * 60 * 60 * 1000;
const R2_LIST_LIMIT = 1000;

export interface CleanupEnv extends AccessGuardEnv {
  STORED: R2Bucket;
}

interface ExpiredRow {
  share_id: string;
  storage_prefix: string;
  state: string;
}

/** Hourly cleanup: expire stale uploads, delete R2 objects, prune abuse rows. */
export async function runCleanup(env: CleanupEnv): Promise<void> {
  await expireStaleUploads(env);
  await deleteExpiredStoredObjects(env);
  await pruneGlobalIpAbuse(env);
}

async function expireStaleUploads(env: CleanupEnv): Promise<void> {
  const cutoff = Date.now() - UPLOAD_STALE_MS;
  await env.DB.prepare(
    `UPDATE stored_shares
     SET state = 'failed'
     WHERE state = 'uploading' AND created_at < ?`,
  )
    .bind(cutoff)
    .run();
}

async function deleteExpiredStoredObjects(env: CleanupEnv): Promise<void> {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT share_id, storage_prefix, state
     FROM stored_shares
     WHERE expires_at <= ? AND state != 'deleted'`,
  )
    .bind(now)
    .all<ExpiredRow>();

  for (const row of results ?? []) {
    await deleteStoragePrefix(env, row.storage_prefix);
    await env.DB.prepare(
      `UPDATE stored_shares SET state = 'deleted' WHERE share_id = ?`,
    )
      .bind(row.share_id)
      .run();
  }
}

async function deleteStoragePrefix(env: CleanupEnv, prefix: string): Promise<void> {
  const base = `v1/stored/${prefix}/`;
  let cursor: string | undefined;

  do {
    const listed = await env.STORED.list({ prefix: base, cursor, limit: R2_LIST_LIMIT });
    if (listed.objects.length === 0) break;

    await Promise.all(listed.objects.map((obj) => env.STORED.delete(obj.key)));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
