import { tokensMatch } from './token-proof';

const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface StatusEnv {
  DB: D1Database;
}

interface DownloadStatusRow {
  state: string;
  expires_at: number;
  downloaded_at: number | null;
  download_status_token_hash: string;
  download_country: string | null;
  download_region: string | null;
  download_network: string | null;
  download_asn: number | null;
}

export async function getDownloadStatus(env: StatusEnv, shareId: string, request: Request): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  const unavailable = () => Response.json({ error: 'unavailable' }, { status: 404, headers });
  const token = request.headers.get('x-drop2-status-token');
  if (!token || token.length > 128) return unavailable();
  const row = await env.DB.prepare(
    `SELECT state, expires_at, downloaded_at, download_status_token_hash,
            download_country, download_region, download_network, download_asn
     FROM stored_shares WHERE share_id = ?`,
  ).bind(shareId).first<DownloadStatusRow>();
  if (!row || row.expires_at + RECEIPT_RETENTION_MS <= Date.now() ||
      !await tokensMatch(token, row.download_status_token_hash)) return unavailable();

  return Response.json({
    state: row.expires_at <= Date.now() ? 'expired' : row.state,
    downloaded_at: row.downloaded_at,
    download_details: row.downloaded_at ? {
      country: row.download_country, region: row.download_region,
      network: row.download_network, asn: row.download_asn,
    } : null,
    expires_at: row.expires_at,
  }, { headers });
}

export async function pruneDownloadStatus(env: StatusEnv): Promise<void> {
  await env.DB.prepare(
    `UPDATE stored_shares SET download_status_token_hash = '', downloaded_at = NULL,
     download_country = NULL, download_region = NULL, download_network = NULL, download_asn = NULL
     WHERE expires_at <= ? AND (download_status_token_hash != '' OR downloaded_at IS NOT NULL)`,
  ).bind(Date.now() - RECEIPT_RETENTION_MS).run();
}
