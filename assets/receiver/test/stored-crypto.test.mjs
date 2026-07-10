import test from 'node:test';
import assert from 'node:assert/strict';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import {
  decryptStoredManifest,
  downloadStoredShare,
  encryptStoredManifest,
  parseCapabilityFragment,
  parsePlaintextManifest,
} from '../src/stored-crypto.js';
import {
  appendEncryptedFrames,
  createFrameState,
  encryptFrame,
  finalizeEncryptedFrames,
} from '../src/frame-stream.js';

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encryptManifest(manifest, capabilityBytes) {
  const key = hkdf(
    sha256,
    capabilityBytes,
    undefined,
    enc.encode('drop2.v1.stored.manifest-key'),
    32,
  );
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const aead = xchacha20poly1305(key, nonce, enc.encode('drop2.v1.stored.manifest'));
  const plain = enc.encode(JSON.stringify(manifest));
  const body = aead.encrypt(plain);
  const out = new Uint8Array(nonce.length + body.length);
  out.set(nonce, 0);
  out.set(body, nonce.length);
  return out;
}

test('decrypts stored manifest with capability secret', () => {
  const capability = crypto.getRandomValues(new Uint8Array(32));
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const manifest = {
    v: 1,
    kind: 'file',
    display_name: 'report.pdf',
    plaintext_size: 4096,
    chunk_count: 1,
    chunk_plaintext_size: 8388608,
    content_dek: b64urlEncode(dek),
  };
  const ciphertext = encryptManifest(manifest, capability);
  const decoded = decryptStoredManifest(ciphertext, capability);
  assert.equal(decoded.display_name, 'report.pdf');
  assert.equal(decoded.plaintext_size, 4096);
});

test('parseCapabilityFragment decodes base64url fragment', () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const fragment = b64urlEncode(raw);
  const parsed = parseCapabilityFragment(fragment);
  assert.deepEqual(parsed, raw);
});

test('parseCapabilityFragment rejects wrong-length fragment when expectedLength is given', () => {
  const tooShort = b64urlEncode(new Uint8Array(8));
  assert.equal(parseCapabilityFragment(tooShort, 32), null);
  assert.equal(parseCapabilityFragment(tooShort).length, 8);
  const justRight = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  assert.equal(parseCapabilityFragment(justRight, 32).length, 32);
});

test('encryptStoredManifest roundtrips with decryptStoredManifest', () => {
  const capability = crypto.getRandomValues(new Uint8Array(32));
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const manifest = {
    v: 1,
    kind: 'file',
    display_name: 'browser.txt',
    plaintext_size: 11,
    chunk_count: 1,
    chunk_plaintext_size: 8388608,
    content_dek: b64urlEncode(dek),
  };

  const ciphertext = encryptStoredManifest(manifest, capability);

  assert.deepEqual(decryptStoredManifest(ciphertext, capability), manifest);
});

test('encryptFrame produces decryptable stored chunk frames', () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = new TextEncoder().encode('hello frame');
  const encrypted = encryptFrame(plaintext, key, 0);
  const state = createFrameState();

  appendEncryptedFrames(state, encrypted, key);

  assert.deepEqual(finalizeEncryptedFrames(state, { expectedBytes: plaintext.length }), plaintext);
});

test('parses a plaintext quick-link manifest', () => {
  const manifest = {
    v: 1,
    encryption_mode: 'none',
    display_name: 'note.txt',
    plaintext_size: 4,
    chunk_count: 1,
  };

  assert.deepEqual(
    parsePlaintextManifest(new TextEncoder().encode(JSON.stringify(manifest))),
    manifest,
  );
});

test('downloads plaintext and defers completion until the caller saves it', async () => {
  const contents = new TextEncoder().encode('quick');
  const manifest = new TextEncoder().encode(JSON.stringify({
    v: 1,
    encryption_mode: 'none',
    display_name: 'note.txt',
    plaintext_size: contents.length,
    chunk_count: 1,
  }));
  const originalFetch = globalThis.fetch;
  const originalPrompt = globalThis.prompt;
  let completeCalls = 0;
  globalThis.prompt = () => '1234';
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/access')) {
      return Response.json({
        download_token: 'token',
        name: 'note.txt',
        size: contents.length,
        chunk_count: 1,
      });
    }
    if (url.endsWith('/manifest')) return new Response(manifest);
    if (url.endsWith('/chunks/1')) return new Response(contents);
    if (url.endsWith('/download-complete') && options.method === 'POST') {
      completeCalls += 1;
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const transfer = await downloadStoredShare({
      shareId: 'abc123',
      capabilityBytes: null,
      info: { pin_required: true, encryption_mode: 'none' },
      onProgress() {},
      onStatus() {},
    });
    assert.deepEqual(transfer.bytes, contents);
    assert.equal(completeCalls, 0);
    assert.equal(await transfer.complete(), true);
    assert.equal(completeCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.prompt = originalPrompt;
  }
});
