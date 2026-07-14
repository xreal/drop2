import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('send success screen includes private five-recipient email delivery', async () => {
  const html = await readFile(join(root, 'send.html'), 'utf8');

  assert.match(html, /id="email-form"/);
  assert.match(html, /id="email-recipients"/);
  assert.match(html, /id="email-message"/);
  assert.match(html, /id="email-send-pin"/);
  assert.match(html, /Up to 5 recipients/);
  assert.doesNotMatch(html, /Private email delivery is being built/);
});
