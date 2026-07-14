import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_EMAIL_MESSAGE_LENGTH,
  MAX_EMAIL_RECIPIENTS,
  buildLinkEmail,
  buildPinEmail,
  parseNotifyPayload,
  sendRecipientEmails,
  validShareUrl,
} from './email-content.ts';

const basePayload = {
  recipients: ['alice@example.com', 'bob@example.com'],
  message: 'Here is the file.',
  share_url: 'https://drop2.app/s/Ab12Cd#secret-capability',
  send_pin_separately: false,
};

test('notification payload accepts and normalizes up to five recipients', () => {
  const parsed = parseNotifyPayload({
    ...basePayload,
    recipients: [
      ' Alice@example.com ',
      'bob@example.com',
      'alice@example.com',
      'carol@example.com',
      'dave@example.com',
      'eve@example.com',
    ],
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.recipients, [
    'Alice@example.com',
    'bob@example.com',
    'carol@example.com',
    'dave@example.com',
    'eve@example.com',
  ]);
  assert.equal(MAX_EMAIL_RECIPIENTS, 5);
});

test('notification payload rejects invalid and excessive input', () => {
  assert.equal(
    parseNotifyPayload({ ...basePayload, recipients: ['not-an-email'] }).ok,
    false,
  );
  assert.equal(
    parseNotifyPayload({
      ...basePayload,
      recipients: Array.from({ length: 6 }, (_, i) => `user${i}@example.com`),
    }).ok,
    false,
  );
  assert.equal(
    parseNotifyPayload({
      ...basePayload,
      message: 'x'.repeat(MAX_EMAIL_MESSAGE_LENGTH + 1),
    }).ok,
    false,
  );
  assert.equal(
    parseNotifyPayload({
      ...basePayload,
      send_pin_separately: true,
      pin: '12ab',
    }).ok,
    false,
  );
});

test('share link must match the request origin, share ID, and encryption mode', () => {
  const capability = 'A'.repeat(43);
  assert.equal(
    validShareUrl(
      `http://localhost:8791/s/EmAil1#${capability}`,
      'http://localhost:8791',
      'EmAil1',
      'end_to_end',
    ),
    true,
  );
  assert.equal(
    validShareUrl(
      `https://evil.example/s/EmAil1#${capability}`,
      'https://drop2.app',
      'EmAil1',
      'end_to_end',
    ),
    false,
  );
  assert.equal(
    validShareUrl('https://drop2.app/s/EmAil1', 'https://drop2.app', 'EmAil1', 'none'),
    true,
  );
});

test('link email escapes user content and never contains the PIN', () => {
  const email = buildLinkEmail({
    recipient: 'alice@example.com',
    fileName: '<report & notes>.pdf',
    message: '<script>alert(1)</script>',
    shareUrl: basePayload.share_url,
  });

  assert.equal(email.to, 'alice@example.com');
  assert.match(email.html, /&lt;report &amp; notes&gt;\.pdf/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.doesNotMatch(email.text, /4821/);
});

test('PIN email contains the PIN but not the capability URL', () => {
  const email = buildPinEmail({ recipient: 'alice@example.com', pin: '4821' });
  assert.match(email.text, /4821/);
  assert.doesNotMatch(email.text, /drop2\.app\/s\//);
});

test('recipients are sent separately and PIN follows only a queued link email', async () => {
  const sent = [];
  const binding = {
    async send(message) {
      sent.push(message);
      if (message.to === 'bob@example.com' && message.subject.includes('file')) {
        throw new Error('simulated failure');
      }
      return { messageId: `message-${sent.length}` };
    },
  };

  const result = await sendRecipientEmails(binding, {
    recipients: ['alice@example.com', 'bob@example.com'],
    fileName: 'report.pdf',
    message: '',
    shareUrl: basePayload.share_url,
    pin: '4821',
    sendPinSeparately: true,
  });

  assert.deepEqual(sent.map((message) => message.to), [
    'alice@example.com',
    'bob@example.com',
    'alice@example.com',
  ]);
  assert.deepEqual(result, {
    queuedRecipients: 1,
    failedRecipients: 1,
    queuedMessages: 2,
    failedPinMessages: 0,
  });
});

test('PIN queue failures are reported separately from link queue failures', async () => {
  const binding = {
    async send(message) {
      if (message.subject.includes('PIN')) throw new Error('simulated PIN failure');
      return { messageId: 'queued-link' };
    },
  };

  const result = await sendRecipientEmails(binding, {
    recipients: ['alice@example.com'],
    fileName: 'report.pdf',
    message: '',
    shareUrl: basePayload.share_url,
    pin: '4821',
    sendPinSeparately: true,
  });

  assert.deepEqual(result, {
    queuedRecipients: 1,
    failedRecipients: 0,
    queuedMessages: 1,
    failedPinMessages: 1,
  });
});
