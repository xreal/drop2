import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function deriveContentKey(sharedSecret) {
  return hkdf(sha256, sharedSecret, undefined, enc.encode('shr.v1.content'), 32);
}

function deriveChunkKey(contentKey, index) {
  const indexBytes = new Uint8Array(8);
  new DataView(indexBytes.buffer).setBigUint64(0, index, true);
  const info = concat(enc.encode('shr.v1.chunk'), indexBytes);
  return hkdf(sha256, contentKey, undefined, info, 32);
}

export function detectShareContext() {
  const hosted = window.location.pathname.match(/^\/s\/([A-Za-z0-9]{6})$/);
  if (hosted) {
    return { mode: 'hosted', shareId: hosted[1] };
  }
  return { mode: 'local', shareId: null };
}

export async function loadShareInfo(ctx) {
  if (ctx.mode === 'hosted') {
    const res = await fetch(`/api/v1/live/${ctx.shareId}`);
    if (!res.ok) throw new Error('Share unavailable');
    return res.json();
  }
  const res = await fetch('/api/info');
  if (!res.ok) throw new Error('Could not load share info');
  return res.json();
}

export async function joinAndDownload({ ctx, info, onProgress, onStatus }) {
  if (ctx.mode === 'hosted') {
    return joinHosted({ ctx, info, onProgress, onStatus });
  }
  return joinLocal({ info, onProgress, onStatus });
}

async function joinLocal({ info, onProgress, onStatus }) {
  onStatus('Preparing secure session…');

  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);

  const joinBody = {
    client_public_key: b64urlEncode(publicKey),
  };
  if (info.pin_required) {
    const pin = prompt('Enter 4-digit PIN');
    if (!pin) throw new Error('PIN required');
    joinBody.pin = pin;
  }

  const joinRes = await fetch('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(joinBody),
  });
  if (!joinRes.ok) {
    throw new Error(await joinRes.text());
  }
  const join = await joinRes.json();

  onStatus('Downloading encrypted stream…');

  const serverPublic = b64urlDecode(join.server_public_key);
  const shared = x25519.getSharedSecret(privateKey, serverPublic);
  const contentKey = deriveContentKey(shared);

  const streamRes = await fetch('/api/stream', {
    headers: { 'x-shr-join-token': join.join_token },
  });
  if (!streamRes.ok) {
    throw new Error(await streamRes.text());
  }

  return readHttpStream(streamRes.body.getReader(), contentKey, onProgress);
}

async function joinHosted({ ctx, info, onProgress, onStatus }) {
  onStatus('Preparing secure session…');

  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);

  const accessBody = {
    client_public_key: b64urlEncode(publicKey),
  };
  if (info.pin_required) {
    const pin = prompt('Enter 4-digit PIN');
    if (!pin) throw new Error('PIN required');
    accessBody.pin = pin;
  }

  const accessRes = await fetch(`/api/v1/live/${ctx.shareId}/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(accessBody),
  });
  if (!accessRes.ok) {
    const err = await accessRes.json().catch(() => ({}));
    throw new Error(err.error || 'Access denied');
  }
  const access = await accessRes.json();

  const serverPublic = b64urlDecode(access.server_public_key);
  const shared = x25519.getSharedSecret(privateKey, serverPublic);
  const contentKey = deriveContentKey(shared);

  onStatus('Downloading encrypted stream…');

  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${window.location.host}${access.connect_url}`;

  return receiveWebSocket(wsUrl, contentKey, onProgress);
}

function receiveWebSocket(wsUrl, contentKey, onProgress) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    let frameBuffer = new Uint8Array(0);
    let chunkIndex = 0n;
    const plainChunks = [];

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') return;
      frameBuffer = concat(frameBuffer, new Uint8Array(event.data));

      while (frameBuffer.length >= 4) {
        const plainLen = new DataView(
          frameBuffer.buffer,
          frameBuffer.byteOffset,
          4,
        ).getUint32(0, true);
        const frameLen = 4 + plainLen + 16;
        if (frameBuffer.length < frameLen) break;

        const frame = frameBuffer.subarray(0, frameLen);
        frameBuffer = frameBuffer.subarray(frameLen);

        const ciphertext = frame.subarray(4);
        const key = deriveChunkKey(contentKey, chunkIndex);
        const nonce = new Uint8Array(24);
        new DataView(nonce.buffer).setBigUint64(0, chunkIndex, true);
        const aead = xchacha20poly1305(key, nonce, enc.encode('shr.v1.chunk'));
        const plain = aead.decrypt(ciphertext);
        plainChunks.push(plain);
        chunkIndex += 1n;
        onProgress(plainChunks.reduce((n, c) => n + c.length, 0));
      }
    };

    ws.onerror = () => reject(new Error('Connection failed'));
    ws.onclose = (event) => {
      if (event.wasClean || plainChunks.length > 0) {
        resolve(concat(...plainChunks));
      } else {
        reject(new Error('Connection closed'));
      }
    };
  });
}

async function readHttpStream(reader, contentKey, onProgress) {
  let frameBuffer = new Uint8Array(0);
  let chunkIndex = 0n;
  const plainChunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    frameBuffer = concat(frameBuffer, value);

    while (frameBuffer.length >= 4) {
      const plainLen = new DataView(
        frameBuffer.buffer,
        frameBuffer.byteOffset,
        4,
      ).getUint32(0, true);
      const frameLen = 4 + plainLen + 16;
      if (frameBuffer.length < frameLen) break;

      const frame = frameBuffer.subarray(0, frameLen);
      frameBuffer = frameBuffer.subarray(frameLen);

      const ciphertext = frame.subarray(4);
      const key = deriveChunkKey(contentKey, chunkIndex);
      const nonce = new Uint8Array(24);
      new DataView(nonce.buffer).setBigUint64(0, chunkIndex, true);
      const aead = xchacha20poly1305(key, nonce, enc.encode('shr.v1.chunk'));
      const plain = aead.decrypt(ciphertext);
      plainChunks.push(plain);
      chunkIndex += 1n;
      onProgress(plainChunks.reduce((n, c) => n + c.length, 0));
    }
  }

  return concat(...plainChunks);
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
