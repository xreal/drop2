import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { b64urlDecode, b64urlEncode } from '../src/base64url.js';
import { linkTokenFor, parseKey, sealSecret, unlockSecret } from '../src/secret-crypto.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('a sealed secret opens with the key from the link', async () => {
  const sealed = await sealSecret('hunter2 🔑');
  const access = await unlockSecret(parseKey(sealed.key));

  assert.equal(await access.open(sealed.ciphertext), 'hunter2 🔑');
  assert.equal(sha256(access.linkToken), sealed.linkHash);
  assert.equal(sha256(access.keyToken), sealed.keyHash);
});

test('the server never receives the plaintext or the key', async () => {
  const sealed = await sealSecret('correct horse battery staple');
  const sent = JSON.stringify({ ciphertext: sealed.ciphertext, link_hash: sealed.linkHash, key_hash: sealed.keyHash });

  assert.doesNotMatch(sent, /correct horse/);
  assert.ok(!sent.includes(sealed.key));
});

test('a wrong passphrase yields a key token the server will reject', async () => {
  const sealed = await sealSecret('db password', 'Ä-passphrase');
  const key = parseKey(sealed.key);
  const wrong = await unlockSecret(key, 'wrong');
  const right = await unlockSecret(key, 'Ä-passphrase');

  assert.notEqual(sha256(wrong.keyToken), sealed.keyHash);
  assert.equal(sha256(right.keyToken), sealed.keyHash, 'passphrases are compared after NFC normalization');
  assert.equal(await right.open(sealed.ciphertext), 'db password');
});

test('the link token does not depend on the passphrase', async () => {
  const sealed = await sealSecret('x', 'secret passphrase');
  const key = parseKey(sealed.key);

  assert.equal(sha256(await linkTokenFor(key)), sealed.linkHash);
});

test('tampered ciphertext is rejected', async () => {
  const sealed = await sealSecret('do not alter');
  const bytes = b64urlDecode(sealed.ciphertext);
  bytes[bytes.length - 1] ^= 1;
  const access = await unlockSecret(parseKey(sealed.key));

  await assert.rejects(access.open(b64urlEncode(bytes)));
});

test('only complete 32-byte keys are accepted from the fragment', () => {
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('abc'), null);
  assert.equal(parseKey('A'.repeat(42)), null);
  assert.equal(parseKey('A'.repeat(42) + '!'), null);
  assert.equal(parseKey('A'.repeat(43)).length, 32);
});
