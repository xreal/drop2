import { jsonError, shareExpired, shareNotReady, shareUnavailable, unauthorized } from './api-errors';
import { isValidShareId } from './share-id';
import {
  MAX_EMAIL_RECIPIENTS,
  parseNotifyPayload,
  sendRecipientEmails,
  validShareUrl,
} from './email-content';
import { reserveEmailMessages } from './email-rate-limit';
import { verifyPin } from './pin';

interface EmailNotifyEnv {
  DB: D1Database;
  EMAIL: SendEmail;
}

interface EmailShareRow {
  state: string;
  expires_at: number;
  display_name: string;
  pin_hash: string;
  pin_salt: string;
  encryption_mode: string;
  email_notify_token_hash: string;
}

export async function createEmailNotifyProof(): Promise<{ token: string; hash: string }> {
  const token = crypto.randomUUID();
  return { token, hash: await hashToken(token) };
}

export async function notifyStoredShare(
  env: EmailNotifyEnv,
  shareId: string,
  request: Request,
  origin: string,
): Promise<Response> {
  if (!isValidShareId(shareId)) return shareUnavailable();
  const row = await env.DB.prepare(
    `SELECT state, expires_at, display_name, pin_hash, pin_salt, encryption_mode,
            email_notify_token_hash
     FROM stored_shares WHERE share_id = ?`,
  )
    .bind(shareId)
    .first<EmailShareRow>();
  if (!row) return shareUnavailable();
  if (row.expires_at <= Date.now()) return shareExpired();
  if (row.state !== 'ready') return shareNotReady();

  const proof = request.headers.get('x-drop2-notify-token');
  if (!proof || !(await tokensMatch(proof, row.email_notify_token_hash))) {
    return unauthorized();
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError('invalid request', 400);
  }
  const parsed = parseNotifyPayload(raw);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const payload = parsed.value;
  if (!validShareUrl(payload.shareUrl, origin, shareId, row.encryption_mode)) {
    console.error(JSON.stringify({
      event: 'email_notify_invalid_share_link',
      share_id: shareId,
      request_origin: origin,
      encryption_mode: row.encryption_mode,
      link: safeLinkDiagnostics(payload.shareUrl),
    }));
    return jsonError('invalid share link', 400);
  }
  if (payload.sendPinSeparately && !row.pin_hash) {
    return jsonError('share has no PIN', 400);
  }
  if (
    payload.sendPinSeparately &&
    payload.pin &&
    !(await verifyPin(payload.pin, row.pin_salt, row.pin_hash))
  ) {
    return jsonError('invalid PIN', 400);
  }

  const reserved = await reserveShareRecipients(env, shareId, payload.recipients.length);
  if (!reserved) return jsonError('email recipient limit reached', 429);

  const requestedMessages = payload.recipients.length * (payload.sendPinSeparately ? 2 : 1);
  if (!(await reserveEmailMessages(env, request, requestedMessages))) {
    await refundShareRecipients(env, shareId, payload.recipients.length);
    return jsonError('email rate limit reached', 429);
  }

  const result = await sendRecipientEmails(env.EMAIL, {
    ...payload,
    fileName: row.display_name,
  });
  if (result.failedRecipients > 0) {
    await refundShareRecipients(env, shareId, result.failedRecipients);
    console.error(JSON.stringify({
      event: 'email_notify_partial_failure',
      share_id: shareId,
      failed_recipients: result.failedRecipients,
    }));
  }
  if (result.queuedRecipients === 0) {
    return jsonError('email delivery unavailable', 503);
  }

  return Response.json({
    queued_recipients: result.queuedRecipients,
    failed_recipients: result.failedRecipients,
    queued_messages: result.queuedMessages,
    failed_pin_messages: result.failedPinMessages,
  }, { status: 202 });
}

async function reserveShareRecipients(
  env: EmailNotifyEnv,
  shareId: string,
  count: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE stored_shares
     SET email_recipient_count = email_recipient_count + ?
     WHERE share_id = ? AND state = 'ready'
       AND email_recipient_count + ? <= ?`,
  )
    .bind(count, shareId, count, MAX_EMAIL_RECIPIENTS)
    .run();
  return result.meta.changes === 1;
}

async function refundShareRecipients(
  env: EmailNotifyEnv,
  shareId: string,
  count: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE stored_shares
     SET email_recipient_count = MAX(0, email_recipient_count - ?)
     WHERE share_id = ?`,
  )
    .bind(count, shareId)
    .run();
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function tokensMatch(token: string, expectedHash: string): Promise<boolean> {
  const actual = new TextEncoder().encode(await hashToken(token));
  const expected = new TextEncoder().encode(expectedHash);
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

function safeLinkDiagnostics(raw: string): { origin?: string; pathname?: string; hashLength?: number } {
  try {
    const url = new URL(raw);
    return { origin: url.origin, pathname: url.pathname, hashLength: url.hash.length };
  } catch {
    return {};
  }
}
