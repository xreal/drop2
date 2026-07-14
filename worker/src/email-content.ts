export const MAX_EMAIL_RECIPIENTS = 5;
export const MAX_EMAIL_MESSAGE_LENGTH = 2_000;

const FROM = { email: 'share@drop2.app', name: 'drop2.app' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedNotifyPayload {
  recipients: string[];
  message: string;
  shareUrl: string;
  pin?: string;
  sendPinSeparately: boolean;
}

type ParseResult =
  | { ok: true; value: ParsedNotifyPayload }
  | { ok: false; error: string };

export function parseNotifyPayload(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('invalid request');
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.recipients)) return invalid('invalid recipients');

  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const value of body.recipients) {
    if (typeof value !== 'string') return invalid('invalid recipients');
    const address = value.trim();
    const key = address.toLowerCase();
    if (!address || address.length > 254 || !EMAIL_PATTERN.test(address)) {
      return invalid('invalid recipients');
    }
    if (!seen.has(key)) {
      seen.add(key);
      recipients.push(address);
    }
  }
  if (recipients.length < 1 || recipients.length > MAX_EMAIL_RECIPIENTS) {
    return invalid('invalid recipients');
  }

  const message = body.message ?? '';
  if (typeof message !== 'string' || message.length > MAX_EMAIL_MESSAGE_LENGTH) {
    return invalid('invalid message');
  }
  if (typeof body.share_url !== 'string') return invalid('invalid share link');
  if (typeof body.send_pin_separately !== 'boolean') {
    return invalid('invalid PIN option');
  }
  const pin = body.pin;
  if (body.send_pin_separately && (typeof pin !== 'string' || !/^\d{4}$/.test(pin))) {
    return invalid('invalid PIN');
  }

  return {
    ok: true,
    value: {
      recipients,
      message,
      shareUrl: body.share_url,
      pin: typeof pin === 'string' ? pin : undefined,
      sendPinSeparately: body.send_pin_separately,
    },
  };
}

export function validShareUrl(
  raw: string,
  origin: string,
  shareId: string,
  encryptionMode: string,
): boolean {
  try {
    const url = new URL(raw);
    const expectedOrigin = new URL(origin).origin;
    const validHash = encryptionMode === 'end_to_end'
      ? /^#[A-Za-z0-9_-]{43}$/.test(url.hash)
      : url.hash === '';
    return url.origin === expectedOrigin &&
      url.pathname === `/s/${shareId}` &&
      url.search === '' &&
      url.username === '' &&
      url.password === '' &&
      validHash;
  } catch {
    return false;
  }
}

export function buildLinkEmail(input: {
  recipient: string;
  fileName: string;
  message: string;
  shareUrl: string;
}): EmailMessageBuilder {
  const fileName = input.fileName.slice(0, 200);
  const noteText = input.message ? `\n\nMessage from the sender:\n${input.message}` : '';
  const noteHtml = input.message
    ? `<p><strong>Message from the sender</strong><br>${escapeHtml(input.message).replace(/\n/g, '<br>')}</p>`
    : '';
  const safeName = escapeHtml(fileName);
  const safeUrl = escapeHtml(input.shareUrl);

  return {
    to: input.recipient,
    from: FROM,
    subject: 'A file was shared with you on drop2.app',
    text: `A file was shared with you on drop2.app.\n\nFile: ${fileName}${noteText}\n\nOpen the share:\n${input.shareUrl}\n\nThis link may contain the decryption capability. Do not forward it.`,
    html: `<p>A file was shared with you on <strong>drop2.app</strong>.</p><p><strong>File:</strong> ${safeName}</p>${noteHtml}<p><a href="${safeUrl}">Open the shared file</a></p><p><small>This link may contain the decryption capability. Do not forward it.</small></p>`,
  };
}

export function buildPinEmail(input: {
  recipient: string;
  pin: string;
}): EmailMessageBuilder {
  return {
    to: input.recipient,
    from: FROM,
    subject: 'Your separate drop2.app PIN',
    text: `Use this PIN to open the drop2.app share sent in a separate email:\n\n${input.pin}\n\nThis email intentionally does not contain the share link.`,
    html: `<p>Use this PIN to open the drop2.app share sent in a separate email:</p><p style="font-size:24px;font-weight:700;letter-spacing:0.2em">${input.pin}</p><p><small>This email intentionally does not contain the share link.</small></p>`,
  };
}

export async function sendRecipientEmails(
  binding: Pick<SendEmail, 'send'>,
  input: {
    recipients: string[];
    fileName: string;
    message: string;
    shareUrl: string;
    pin?: string;
    sendPinSeparately: boolean;
  },
): Promise<{
  queuedRecipients: number;
  failedRecipients: number;
  queuedMessages: number;
  failedPinMessages: number;
}> {
  const linkResults = await Promise.allSettled(
    input.recipients.map((recipient) =>
      binding.send(buildLinkEmail({ recipient, ...input })),
    ),
  );
  const queuedRecipients = input.recipients.filter((_, index) =>
    linkResults[index].status === 'fulfilled',
  );

  let queuedPinMessages = 0;
  if (input.sendPinSeparately && input.pin) {
    const pin = input.pin;
    const pinResults = await Promise.allSettled(
      queuedRecipients.map((recipient) => binding.send(buildPinEmail({ recipient, pin }))),
    );
    queuedPinMessages = pinResults.filter((result) => result.status === 'fulfilled').length;
  }

  return {
    queuedRecipients: queuedRecipients.length,
    failedRecipients: input.recipients.length - queuedRecipients.length,
    queuedMessages: queuedRecipients.length + queuedPinMessages,
    failedPinMessages: input.sendPinSeparately
      ? queuedRecipients.length - queuedPinMessages
      : 0,
  };
}

function invalid(error: string): ParseResult {
  return { ok: false, error };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}
