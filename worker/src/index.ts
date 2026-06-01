import { LiveShareDO } from './live-share-do';
import type { Env } from './types';
import { generateShareId, isValidShareId } from './share-id';
import { jsonError } from './api-errors';
import { runCleanup } from './cleanup';
import {
  accessStoredShare,
  completeStoredShare,
  createStoredShare,
  downloadChunk,
  downloadManifest,
  getStoredShareInfo,
  uploadChunk,
  uploadManifest,
} from './stored-share';
import { validPinMaterial } from './pin';

export { LiveShareDO };

const MAX_WAIT_SECONDS = 7 * 24 * 60 * 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/v1/health') {
      return Response.json({ ok: true, service: 'drop2.app' });
    }

    if (url.pathname.startsWith('/assets/')) {
      const assetPath = url.pathname.slice('/assets/'.length);
      const assetUrl = new URL(`/${assetPath}`, 'https://assets.local/');
      return env.ASSETS.fetch(new Request(assetUrl));
    }

    const sharePage = url.pathname.match(/^\/s\/([A-Za-z0-9]{6})$/);
    if (sharePage && request.method === 'GET') {
      return serveReceiverShell(env);
    }

    if (url.pathname === '/api/v1/live' && request.method === 'POST') {
      return createLiveShare(request, env, url);
    }

    const shareInfo = url.pathname.match(/^\/api\/v1\/shares\/([A-Za-z0-9]{6})$/);
    if (shareInfo && request.method === 'GET') {
      return getUnifiedShareInfo(env, shareInfo[1]);
    }

    const liveInfo = url.pathname.match(/^\/api\/v1\/live\/([A-Za-z0-9]{6})$/);
    if (liveInfo && request.method === 'GET') {
      return proxyToDo(liveInfo[1], env, '/info', request);
    }

    const liveAccess = url.pathname.match(
      /^\/api\/v1\/live\/([A-Za-z0-9]{6})\/access$/,
    );
    if (liveAccess && request.method === 'POST') {
      return admitReceiver(liveAccess[1], request, env);
    }

    const liveConnect = url.pathname.match(
      /^\/api\/v1\/live\/([A-Za-z0-9]{6})\/connect$/,
    );
    if (liveConnect && request.method === 'GET') {
      if (!isValidShareId(liveConnect[1])) {
        return jsonError('invalid share id', 400);
      }
      return doStub(env, liveConnect[1]).fetch(request);
    }

    const liveDelete = url.pathname.match(
      /^\/api\/v1\/live\/([A-Za-z0-9]{6})$/,
    );
    if (liveDelete && request.method === 'DELETE') {
      return cancelLiveShare(liveDelete[1], request, env);
    }

    if (url.pathname === '/api/v1/stored' && request.method === 'POST') {
      return handleCreateStored(request, env, url);
    }

    const storedInfo = url.pathname.match(/^\/api\/v1\/stored\/([A-Za-z0-9]{6})$/);
    if (storedInfo && request.method === 'GET') {
      return getStoredShareInfo(env, storedInfo[1]);
    }

    const storedAccess = url.pathname.match(
      /^\/api\/v1\/stored\/([A-Za-z0-9]{6})\/access$/,
    );
    if (storedAccess && request.method === 'POST') {
      return accessStoredShare(env, storedAccess[1], request);
    }

    const storedComplete = url.pathname.match(
      /^\/api\/v1\/stored\/([A-Za-z0-9]{6})\/complete$/,
    );
    if (storedComplete && request.method === 'POST') {
      return completeStoredShare(env, storedComplete[1], request);
    }

    const storedManifestPut = url.pathname.match(
      /^\/api\/v1\/stored\/([A-Za-z0-9]{6})\/manifest$/,
    );
    if (storedManifestPut && request.method === 'PUT') {
      return uploadManifest(env, storedManifestPut[1], request);
    }

    const storedManifestGet = url.pathname.match(
      /^\/api\/v1\/stored\/([A-Za-z0-9]{6})\/manifest$/,
    );
    if (storedManifestGet && request.method === 'GET') {
      return downloadManifest(env, storedManifestGet[1], request);
    }

    const storedChunkPut = url.pathname.match(
      /^\/api\/v1\/stored\/([A-Za-z0-9]{6})\/chunks\/(\d+)$/,
    );
    if (storedChunkPut && request.method === 'PUT') {
      return uploadChunk(env, storedChunkPut[1], Number(storedChunkPut[2]), request);
    }

    const storedChunkGet = url.pathname.match(
      /^\/api\/v1\/stored\/([A-Za-z0-9]{6})\/chunks\/(\d+)$/,
    );
    if (storedChunkGet && request.method === 'GET') {
      return downloadChunk(env, storedChunkGet[1], Number(storedChunkGet[2]), request);
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('drop2.app', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runCleanup(env);
  },
};

async function getUnifiedShareInfo(env: Env, shareId: string): Promise<Response> {
  if (!isValidShareId(shareId)) {
    return jsonError('invalid share id', 400);
  }

  const storedRes = await getStoredShareInfo(env, shareId);
  if (storedRes.status !== 404) {
    return storedRes;
  }

  return proxyToDo(shareId, env, '/info', new Request('https://do/info'));
}

async function serveReceiverShell(env: Env): Promise<Response> {
  const assetUrl = new URL('/index.html', 'https://assets.local/');
  const res = await env.ASSETS.fetch(new Request(assetUrl));
  if (!res.ok) return new Response('Receiver unavailable', { status: 503 });
  const html = await res.text();
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function doStub(env: Env, shareId: string) {
  const id = env.LIVE_SHARE.idFromName(shareId);
  return env.LIVE_SHARE.get(id);
}

async function createLiveShare(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError('invalid request body', 400);
  }

  const kind = body.kind;
  const name = body.name;
  const size = body.size;
  const waitSeconds = body.wait_seconds;
  const pinSalt = body.pin_salt;
  const pinHash = body.pin_hash;

  if (kind !== 'file' && kind !== 'folder') {
    return jsonError('invalid kind', 400);
  }
  if (typeof name !== 'string' || !name) {
    return jsonError('invalid name', 400);
  }
  if (!isNonNegativeSafeInteger(size)) {
    return jsonError('invalid size', 400);
  }
  if (!isWaitSeconds(waitSeconds)) {
    return jsonError('invalid wait timeout', 400);
  }
  if (typeof pinSalt !== 'string' || typeof pinHash !== 'string') {
    return jsonError('invalid pin material', 400);
  }
  if (!validPinMaterial(pinSalt, pinHash)) {
    return jsonError('invalid pin material', 400);
  }

  const shareId = generateShareId();
  const senderToken = crypto.randomUUID();
  const initBody = {
    share_id: shareId,
    kind,
    name,
    size,
    wait_seconds: waitSeconds,
    pin_salt: pinSalt,
    pin_hash: pinHash,
    sender_token: senderToken,
  };

  const initRes = await doStub(env, shareId).fetch(
    new Request('https://do/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(initBody),
    }),
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    return jsonError(err || 'init failed', initRes.status);
  }

  const base = url.origin;
  return Response.json({
    share_id: shareId,
    share_url: `${base}/s/${shareId}`,
    sender_token: senderToken,
    connect_url: `/api/v1/live/${shareId}/connect?role=sender&token=${encodeURIComponent(senderToken)}`,
    wait_seconds: waitSeconds,
  });
}

async function admitReceiver(
  shareId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isValidShareId(shareId)) return jsonError('invalid share id', 400);

  const body = await request.text();
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';

  const res = await doStub(env, shareId).fetch(
    new Request('https://do/admit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-drop2-ip': ip,
      },
      body,
    }),
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'access denied' }));
    return Response.json(err, { status: res.status });
  }

  const data = (await res.json()) as {
    server_public_key: string;
    join_token: string;
    status: string;
  };

  return Response.json({
    server_public_key: data.server_public_key,
    join_token: data.join_token,
    connect_url: `/api/v1/live/${shareId}/connect?role=receiver&token=${encodeURIComponent(data.join_token)}`,
    status: data.status,
  });
}

async function proxyToDo(
  shareId: string,
  env: Env,
  path: string,
  request: Request,
): Promise<Response> {
  if (!isValidShareId(shareId)) return jsonError('invalid share id', 400);

  const url = new URL(request.url);
  const target = new URL(`https://do${path}${url.search}`);

  const headers = new Headers(request.headers);
  const res = await doStub(env, shareId).fetch(
    new Request(target, { method: request.method, headers }),
  );

  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
}

async function cancelLiveShare(
  shareId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isValidShareId(shareId)) return jsonError('invalid share id', 400);
  const token = request.headers.get('x-drop2-sender-token');
  if (!token) return jsonError('missing sender token', 401);

  const res = await doStub(env, shareId).fetch(
    new Request('https://do/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  );

  return new Response(res.body, { status: res.status });
}

async function handleCreateStored(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError('invalid request body', 400);
  }

  return createStoredShare(
    env,
    {
      kind: body.kind as 'file' | 'folder',
      name: body.name as string,
      size: body.size as number,
      expires_seconds: body.expires_seconds as number,
      pin_salt: body.pin_salt as string,
      pin_hash: body.pin_hash as string,
      chunk_count: body.chunk_count as number,
      chunk_plaintext_size: body.chunk_plaintext_size as number,
      manifest_ciphertext_bytes: body.manifest_ciphertext_bytes as number,
      ciphertext_bytes_total: body.ciphertext_bytes_total as number,
    },
    url.origin,
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isWaitSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_WAIT_SECONDS
  );
}
