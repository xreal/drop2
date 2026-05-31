import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import {
  appendEncryptedFrames,
  createFrameState,
  finalizeEncryptedFrames,
} from './frame-stream.js';
import { downloadStoredShare, parseCapabilityFragment } from './stored-crypto.js';

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

export function detectShareContext() {
  const hosted = window.location.pathname.match(/^\/s\/([A-Za-z0-9]{6})$/);
  if (hosted) {
    const capability = parseCapabilityFragment(window.location.hash.slice(1));
    return { mode: 'hosted', shareId: hosted[1], capability };
  }
  return { mode: 'local', shareId: null, capability: null };
}

export async function loadShareInfo(ctx) {
  if (ctx.mode === 'hosted') {
    const storedRes = await fetch(`/api/v1/stored/${ctx.shareId}`);
    if (storedRes.ok) {
      return storedRes.json();
    }
    const liveRes = await fetch(`/api/v1/live/${ctx.shareId}`);
    if (!liveRes.ok) throw new Error('Share unavailable');
    return liveRes.json();
  }
  const res = await fetch('/api/info');
  if (!res.ok) throw new Error('Could not load share info');
  return res.json();
}

export async function joinAndDownload({ ctx, info, onProgress, onStatus }) {
  if (info.mode === 'stored') {
    if (!ctx.capability) {
      throw new Error('Missing capability secret in URL');
    }
    return downloadStoredShare({
      shareId: ctx.shareId,
      capabilityBytes: ctx.capability,
      info,
      onProgress,
      onStatus,
    });
  }

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

  return readHttpStream(
    streamRes.body.getReader(),
    contentKey,
    onProgress,
    expectedPlaintextSize(info),
  );
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

  return receiveWebSocket(wsUrl, contentKey, onProgress, expectedPlaintextSize(info));
}

function receiveWebSocket(wsUrl, contentKey, onProgress, expectedBytes) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    const state = createFrameState();
    let transferComplete = false;
    let settled = false;

    function finish() {
      if (settled) return;
      settled = true;
      try {
        resolve(
          finalizeEncryptedFrames(state, {
            expectedBytes,
            requireTransferComplete: true,
            transferComplete,
          }),
        );
      } catch (error) {
        reject(error);
      }
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = parseWsControl(event.data);
        if (msg?.type === 'transfer_complete') {
          transferComplete = true;
          finish();
        } else if (msg?.type === 'error') {
          settled = true;
          reject(new Error(msg.message || 'Transfer failed'));
        }
        return;
      }

      try {
        onProgress(appendEncryptedFrames(state, new Uint8Array(event.data), contentKey));
      } catch (error) {
        settled = true;
        reject(error);
        ws.close();
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error('Connection failed'));
      }
    };
    ws.onclose = () => {
      if (!settled) {
        if (transferComplete) {
          finish();
        } else {
          settled = true;
          reject(new Error('Transfer incomplete'));
        }
      }
    };
  });
}

async function readHttpStream(reader, contentKey, onProgress, expectedBytes) {
  const state = createFrameState();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onProgress(appendEncryptedFrames(state, value, contentKey));
  }

  return finalizeEncryptedFrames(state, { expectedBytes });
}

function expectedPlaintextSize(info) {
  return info.kind === 'file' ? info.size : undefined;
}

function parseWsControl(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
