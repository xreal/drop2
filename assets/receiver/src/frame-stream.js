import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

const enc = new TextEncoder();

export function createFrameState() {
  return {
    frameBuffer: new Uint8Array(0),
    chunkIndex: 0n,
    plainChunks: [],
    receivedBytes: 0,
  };
}

export function appendEncryptedFrames(state, bytes, contentKey) {
  state.frameBuffer = concat(state.frameBuffer, bytes);

  while (state.frameBuffer.length >= 4) {
    const plainLen = new DataView(
      state.frameBuffer.buffer,
      state.frameBuffer.byteOffset,
      4,
    ).getUint32(0, true);
    const frameLen = 4 + plainLen + 16;
    if (state.frameBuffer.length < frameLen) break;

    const frame = state.frameBuffer.subarray(0, frameLen);
    state.frameBuffer = state.frameBuffer.subarray(frameLen);

    const ciphertext = frame.subarray(4);
    const key = deriveChunkKey(contentKey, state.chunkIndex);
    const nonce = new Uint8Array(24);
    new DataView(nonce.buffer).setBigUint64(0, state.chunkIndex, true);
    const aead = xchacha20poly1305(key, nonce, enc.encode('shr.v1.chunk'));
    const plain = aead.decrypt(ciphertext);
    state.plainChunks.push(plain);
    state.chunkIndex += 1n;
    state.receivedBytes += plain.length;
  }

  return state.receivedBytes;
}

export function finalizeEncryptedFrames(
  state,
  { expectedBytes, requireTransferComplete = false, transferComplete = true } = {},
) {
  if (state.frameBuffer.length !== 0) {
    throw new Error('Transfer incomplete');
  }
  if (requireTransferComplete && !transferComplete) {
    throw new Error('Transfer incomplete');
  }
  if (
    typeof expectedBytes === 'number' &&
    Number.isSafeInteger(expectedBytes) &&
    state.receivedBytes !== expectedBytes
  ) {
    throw new Error('Transfer size mismatch');
  }
  return concat(...state.plainChunks);
}

function deriveChunkKey(contentKey, index) {
  const indexBytes = new Uint8Array(8);
  new DataView(indexBytes.buffer).setBigUint64(0, index, true);
  const info = concat(enc.encode('shr.v1.chunk'), indexBytes);
  return hkdf(sha256, contentKey, undefined, info, 32);
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
