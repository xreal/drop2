import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLiveAccess, completeLiveJoin, verifyLiveCompletion } from '../src/live-crypto.js';
import { b64urlDecode, b64urlEncode } from '../src/stored-crypto.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/live-handshake.json', import.meta.url)));
const capability = b64urlDecode(fixture.capability);
const privateKey = b64urlDecode(fixture.client_private_key);

test('live handshake matches the shared Rust/browser contract fixture', () => {
  assert.deepEqual(createLiveAccess(capability, fixture.share_id, privateKey), {
    client_public_key: fixture.client_public_key,
    client_proof: fixture.client_proof,
  });
  assert.equal(b64urlEncode(completeLiveJoin(capability, fixture.share_id, privateKey, fixture)), fixture.content_key);
});

test('rejects a relay substituting the sender key, proof, share, or receiver', () => {
  assert.throws(() => completeLiveJoin(capability, 'abc124', privateKey, fixture));
  assert.throws(() => completeLiveJoin(new Uint8Array(32), fixture.share_id, privateKey, fixture));
  assert.throws(() => completeLiveJoin(capability, fixture.share_id, new Uint8Array(32).fill(9), fixture));
  assert.throws(() => completeLiveJoin(capability, fixture.share_id, privateKey, {
    ...fixture, server_public_key: fixture.client_public_key,
  }));
  assert.throws(() => completeLiveJoin(capability, fixture.share_id, privateKey, {
    ...fixture, server_proof: fixture.client_proof,
  }));
});

test('live joins fail closed without a valid capability or authenticated response', () => {
  for (const cap of [null, undefined, new Uint8Array(31)]) {
    assert.throws(() => createLiveAccess(cap, fixture.share_id, privateKey));
  }
  assert.throws(() => completeLiveJoin(capability, fixture.share_id, privateKey, {
    server_public_key: fixture.server_public_key,
  }));
});

test('authenticated completion rejects truncation, altered lengths, and forged completion', () => {
  const key = b64urlDecode(fixture.content_key);
  assert.doesNotThrow(() => verifyLiveCompletion(key, fixture.plaintext_bytes, fixture));
  assert.throws(() => verifyLiveCompletion(key, 65536, fixture));
  assert.throws(() => verifyLiveCompletion(key, 65536, {...fixture, plaintext_bytes:65536}));
  assert.throws(() => verifyLiveCompletion(key, fixture.plaintext_bytes, {...fixture, completion_proof:fixture.client_proof}));
});
