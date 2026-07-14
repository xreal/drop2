import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from './auth-limits';

export interface AuthSecrets {
  AUTH_SESSION_SECRET: string;
}

export interface AccountRow {
  account_id: string;
  github_user_id: number;
  github_login: string;
  github_created_at: number;
  public_repos: number;
  eligible: number;
  status: string;
  created_at: number;
  updated_at: number;
  suspended_at: number | null;
}

export interface SessionAccount {
  session_id: string;
  account: AccountRow;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(byteLength: number = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSign(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(sig));
}

export async function createOauthState(
  secret: string,
  nowMs: number = Date.now(),
  secure: boolean = true,
): Promise<{ state: string; cookie: string }> {
  const nonce = randomToken(16);
  const exp = String(nowMs + OAUTH_STATE_TTL_MS);
  const payload = `${nonce}.${exp}`;
  const sig = await hmacSign(secret, payload);
  const state = `${payload}.${sig}`;
  return {
    state,
    cookie: serializeCookie(OAUTH_STATE_COOKIE, state, {
      maxAgeSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
    }),
  };
}

export async function verifyOauthState(
  secret: string,
  state: string,
  cookieState: string | null,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!state || !cookieState || state !== cookieState) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, expRaw, sig] = parts;
  if (!nonce || !expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < nowMs) return false;
  const expected = await hmacSign(secret, `${nonce}.${expRaw}`);
  return timingSafeEqualHex(sig, expected);
}

export async function createSession(
  db: D1Database,
  accountId: string,
  nowMs: number = Date.now(),
  secure: boolean = true,
): Promise<{ token: string; cookie: string; expiresAt: number }> {
  const sessionId = crypto.randomUUID();
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = nowMs + SESSION_TTL_MS;

  await db
    .prepare(
      `INSERT INTO sessions (session_id, account_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(sessionId, accountId, tokenHash, expiresAt, nowMs)
    .run();

  return {
    token,
    expiresAt,
    cookie: serializeCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
    }),
  };
}

export async function resolveSession(
  db: D1Database,
  request: Request,
  nowMs: number = Date.now(),
): Promise<SessionAccount | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT
         s.session_id AS session_id,
         a.account_id AS account_id,
         a.github_user_id AS github_user_id,
         a.github_login AS github_login,
         a.github_created_at AS github_created_at,
         a.public_repos AS public_repos,
         a.eligible AS eligible,
         a.status AS status,
         a.created_at AS created_at,
         a.updated_at AS updated_at,
         a.suspended_at AS suspended_at,
         s.expires_at AS expires_at,
         s.revoked_at AS revoked_at
       FROM sessions s
       JOIN accounts a ON a.account_id = s.account_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      session_id: string;
      account_id: string;
      github_user_id: number;
      github_login: string;
      github_created_at: number;
      public_repos: number;
      eligible: number;
      status: string;
      created_at: number;
      updated_at: number;
      suspended_at: number | null;
      expires_at: number;
      revoked_at: number | null;
    }>();

  if (!row) return null;
  if (row.revoked_at != null || row.expires_at <= nowMs) return null;
  if (row.status === 'suspended') return null;

  return {
    session_id: row.session_id,
    account: {
      account_id: row.account_id,
      github_user_id: row.github_user_id,
      github_login: row.github_login,
      github_created_at: row.github_created_at,
      public_repos: row.public_repos,
      eligible: row.eligible,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      suspended_at: row.suspended_at,
    },
  };
}

export async function revokeSession(
  db: D1Database,
  request: Request,
  nowMs: number = Date.now(),
): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(nowMs, tokenHash)
    .run();
}

export function clearSessionCookie(secure: boolean = true): string {
  return serializeCookie(SESSION_COOKIE, '', {
    maxAgeSeconds: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  });
}

export function clearOauthStateCookie(secure: boolean = true): string {
  return serializeCookie(OAUTH_STATE_COOKIE, '', {
    maxAgeSeconds: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds: number;
    httpOnly: boolean;
    sameSite: 'Lax' | 'Strict' | 'None';
    secure: boolean;
    path: string;
  },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
