import { x25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { b64urlDecode, b64urlEncode } from './stored-crypto.js';

const enc = new TextEncoder();

function transcript(domain, shareId, clientPublic, serverPublic = new Uint8Array()) {
  return new Uint8Array([...enc.encode(domain + shareId), ...clientPublic, ...serverPublic]);
}

function requireCapability(capability, shareId) {
  if (!(capability instanceof Uint8Array) || capability.length !== 32 ||
      !/^[A-Za-z0-9]{6}$/.test(shareId)) {
    throw new Error('A complete live share link with its capability is required');
  }
}

export function createLiveAccess(capability, shareId, privateKey) {
  requireCapability(capability, shareId);
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    client_public_key: b64urlEncode(publicKey),
    client_proof: b64urlEncode(hmac(sha256, capability,
      transcript('drop2.v2.live.client', shareId, publicKey))),
  };
}

export function completeLiveJoin(capability, shareId, privateKey, response) {
  requireCapability(capability, shareId);
  const clientPublic = x25519.getPublicKey(privateKey);
  const serverPublic = b64urlDecode(response.server_public_key);
  const proof = b64urlDecode(response.server_proof);
  if (serverPublic.length !== 32 || proof.length !== 32) {
    throw new Error('Invalid sender authentication');
  }
  const expected = hmac(sha256, capability,
    transcript('drop2.v2.live.server', shareId, clientPublic, serverPublic));
  let difference = 0;
  for (let i = 0; i < 32; i += 1) difference |= expected[i] ^ proof[i];
  if (difference !== 0) throw new Error('Sender authentication failed');
  const shared = x25519.getSharedSecret(privateKey, serverPublic);
  const dhContentKey = hkdf(sha256, shared, undefined, enc.encode('drop2.v1.content'), 32);
  return hkdf(sha256, dhContentKey, capability,
    transcript('drop2.v2.live.content', shareId, clientPublic, serverPublic), 32);
}

export function verifyLiveCompletion(contentKey, receivedBytes, message) {
  if (!Number.isSafeInteger(message.plaintext_bytes) || message.plaintext_bytes < 0 ||
      message.plaintext_bytes !== receivedBytes) throw new Error('Transfer incomplete');
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(receivedBytes), true);
  const expected = hmac(sha256, contentKey,
    new Uint8Array([...enc.encode('drop2.v2.live.complete'), ...length]));
  const proof = b64urlDecode(message.completion_proof);
  if (proof.length !== 32) throw new Error('Invalid transfer completion');
  let difference = 0;
  for (let i = 0; i < 32; i += 1) difference |= expected[i] ^ proof[i];
  if (difference !== 0) throw new Error('Invalid transfer completion');
}
