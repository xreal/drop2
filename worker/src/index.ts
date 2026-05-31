import { LiveShareDO } from './live-share-do';
import type { Env } from './types';
import { generateShareId, isValidShareId } from './share-id';

export { LiveShareDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/v1/health') {
      return Response.json({ ok: true, service: 'shr.rip' });
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
      return proxyToDo(liveConnect[1], env, '/connect', request);
    }

    const liveDelete = url.pathname.match(
      /^\/api\/v1\/live\/([A-Za-z0-9]{6})$/,
    );
    if (liveDelete && request.method === 'DELETE') {
      return cancelLiveShare(liveDelete[1], request, env);
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('shr.rip', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

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
  if (typeof size !== 'number' || size < 0) {
    return jsonError('invalid size', 400);
  }
  if (typeof waitSeconds !== 'number' || waitSeconds < 1) {
    return jsonError('invalid wait timeout', 400);
  }
  if (typeof pinSalt !== 'string' || typeof pinHash !== 'string') {
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
        'x-shr-ip': ip,
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
  const token = request.headers.get('x-shr-sender-token');
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

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
