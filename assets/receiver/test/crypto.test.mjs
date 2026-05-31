import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import {
  appendEncryptedFrames,
  createFrameState,
  finalizeEncryptedFrames,
} from '../src/frame-stream.js';

const enc = new TextEncoder();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function deriveChunkKey(contentKey, index) {
  const indexBytes = new Uint8Array(8);
  new DataView(indexBytes.buffer).setBigUint64(0, index, true);
  const info = new Uint8Array(enc.encode('shr.v1.chunk').length + indexBytes.length);
  info.set(enc.encode('shr.v1.chunk'), 0);
  info.set(indexBytes, enc.encode('shr.v1.chunk').length);
  return hkdf(sha256, contentKey, undefined, info, 32);
}

function b64ToBytes(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function decryptFrames(contentKey, frames) {
  const parts = [];
  let offset = 0;
  let chunkIndex = 0n;

  while (offset < frames.length) {
    const plainLen = new DataView(frames.buffer, frames.byteOffset + offset, 4).getUint32(0, true);
    const frameLen = 4 + plainLen + 16;
    const frame = frames.subarray(offset, offset + frameLen);
    offset += frameLen;

    const ciphertext = frame.subarray(4);
    const key = deriveChunkKey(contentKey, chunkIndex);
    const nonce = new Uint8Array(24);
    new DataView(nonce.buffer).setBigUint64(0, chunkIndex, true);
    const aead = xchacha20poly1305(key, nonce, enc.encode('shr.v1.chunk'));
    parts.push(aead.decrypt(ciphertext));
    chunkIndex += 1n;
  }

  const total = parts.reduce((n, part) => n + part.length, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.length;
  }
  return merged;
}

test('decrypts rust-generated 778-byte fixture', () => {
  const fixture = JSON.parse(
    readFileSync(join(root, 'test/fixtures/frame-stream-778.json'), 'utf8'),
  );
  const contentKey = b64ToBytes(fixture.content_key_b64);
  const frames = b64ToBytes(fixture.frames_b64);
  const expected = b64ToBytes(fixture.plaintext_b64);

  const plaintext = decryptFrames(contentKey, frames);
  assert.equal(plaintext.length, 778);
  assert.deepEqual(plaintext, expected);
});

test('aad is passed at cipher construction, not decrypt output', () => {
  const key = new Uint8Array(32).fill(9);
  const nonce = new Uint8Array(24);
  const aead = xchacha20poly1305(key, nonce, enc.encode('shr.v1.chunk'));
  const message = enc.encode('hello');
  const sealed = aead.encrypt(message);
  const opened = aead.decrypt(sealed);
  assert.deepEqual(opened, message);
});

test('rejects truncated frame tails', () => {
  const fixture = JSON.parse(
    readFileSync(join(root, 'test/fixtures/frame-stream-778.json'), 'utf8'),
  );
  const contentKey = b64ToBytes(fixture.content_key_b64);
  const frames = b64ToBytes(fixture.frames_b64);

  const state = createFrameState();
  appendEncryptedFrames(state, frames.subarray(0, frames.length - 1), contentKey);

  assert.throws(
    () => finalizeEncryptedFrames(state),
    /Transfer incomplete/,
  );
});

test('requires explicit hosted transfer completion', () => {
  const fixture = JSON.parse(
    readFileSync(join(root, 'test/fixtures/frame-stream-778.json'), 'utf8'),
  );
  const contentKey = b64ToBytes(fixture.content_key_b64);
  const frames = b64ToBytes(fixture.frames_b64);

  const state = createFrameState();
  appendEncryptedFrames(state, frames, contentKey);

  assert.throws(
    () =>
      finalizeEncryptedFrames(state, {
        requireTransferComplete: true,
        transferComplete: false,
      }),
    /Transfer incomplete/,
  );
});
