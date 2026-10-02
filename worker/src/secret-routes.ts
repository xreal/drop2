import type { Env } from './types';
import { createSecret, destroySecret, revealSecret, secretStatus } from './secret-store';
import { serveStaticHtml } from './static-html';

const PAGE_HEADERS = {
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-opener-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};

const SECRET_PAGE = /^\/secret\/[A-Za-z0-9]{12}$/;
const SECRET_API = /^\/api\/v1\/secrets\/([A-Za-z0-9]{12})(\/status|\/reveal)?$/;

/** Handles `/secret*` pages and `/api/v1/secrets*`; returns null for every other path. */
export async function routeSecrets(request: Request, env: Env, url: URL): Promise<Response | null> {
  const { pathname } = url;
  const method = request.method;

  if (method === 'GET' && pathname === '/secret') return serveSecretPage(env);
  if (method === 'GET' && SECRET_PAGE.test(pathname)) return serveSecretPage(env, { 'x-robots-tag': 'noindex' });
  if (method === 'POST' && pathname === '/api/v1/secrets') return noStore(await createSecret(env, request));

  const match = pathname.match(SECRET_API);
  if (!match) return null;
  const [, id, action] = match;
  if (method === 'POST' && action === '/status') return noStore(await secretStatus(env, id, request));
  if (method === 'POST' && action === '/reveal') return noStore(await revealSecret(env, id, request));
  if (method === 'DELETE' && action === undefined) return noStore(await destroySecret(env, id, request));
  return null;
}

function serveSecretPage(env: Env, headers: Record<string, string> = {}): Promise<Response> {
  return serveStaticHtml(env, '/secret.html', 'Secret page unavailable', { ...PAGE_HEADERS, ...headers });
}

function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  return response;
}
