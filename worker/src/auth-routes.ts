import {
  BROWSER_ANON_MAX_PLAINTEXT_BYTES,
  BROWSER_AUTH_MAX_PLAINTEXT_BYTES,
  DAILY_QUOTA_BYTES,
  OAUTH_STATE_COOKIE,
  WEEKLY_QUOTA_BYTES,
  isEligibleAccount,
  parseGithubCreatedAt,
} from './auth-limits';
import {
  exchangeGithubCode,
  fetchGithubUser,
  githubAuthorizeUrl,
} from './auth-github';
import { evaluateQuota, loadQuotaUsage } from './auth-quota';
import {
  clearOauthStateCookie,
  clearSessionCookie,
  createOauthState,
  createSession,
  readCookie,
  resolveSession,
  revokeSession,
  verifyOauthState,
} from './auth-session';
import { jsonError } from './api-errors';

export interface AuthRouteEnv {
  DB: D1Database;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  AUTH_SESSION_SECRET?: string;
}

function authConfigured(env: AuthRouteEnv): env is AuthRouteEnv & {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  AUTH_SESSION_SECRET: string;
} {
  return Boolean(
    env.GITHUB_CLIENT_ID &&
      env.GITHUB_CLIENT_SECRET &&
      env.AUTH_SESSION_SECRET,
  );
}

function oauthRedirectUri(origin: string): string {
  return `${origin}/auth/github/callback`;
}

function cookieSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

function redirectWithCookies(
  location: string,
  cookies: string[],
): Response {
  const headers = new Headers({ location });
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(null, { status: 302, headers });
}

export async function handleGithubStart(
  request: Request,
  env: AuthRouteEnv,
): Promise<Response> {
  if (!authConfigured(env)) {
    return jsonError('github auth is not configured', 503);
  }
  const url = new URL(request.url);
  const secure = cookieSecure(request);
  const { state, cookie } = await createOauthState(
    env.AUTH_SESSION_SECRET,
    Date.now(),
    secure,
  );
  const authorize = githubAuthorizeUrl(
    {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
    oauthRedirectUri(url.origin),
    state,
  );
  return redirectWithCookies(authorize, [cookie]);
}

export async function handleGithubCallback(
  request: Request,
  env: AuthRouteEnv,
): Promise<Response> {
  if (!authConfigured(env)) {
    return jsonError('github auth is not configured', 503);
  }

  const url = new URL(request.url);
  const secure = cookieSecure(request);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = readCookie(request, OAUTH_STATE_COOKIE);

  if (
    !code ||
    !state ||
    !(await verifyOauthState(env.AUTH_SESSION_SECRET, state, cookieState))
  ) {
    return redirectWithCookies('/send?auth=error', [
      clearOauthStateCookie(secure),
    ]);
  }

  try {
    const accessToken = await exchangeGithubCode(
      {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      code,
      oauthRedirectUri(url.origin),
    );
    const githubUser = await fetchGithubUser(accessToken);
    const createdAtMs = parseGithubCreatedAt(githubUser.created_at);
    if (createdAtMs == null) {
      return redirectWithCookies('/send?auth=error', [
        clearOauthStateCookie(secure),
      ]);
    }

    const now = Date.now();
    const eligible = isEligibleAccount(createdAtMs, githubUser.public_repos, now)
      ? 1
      : 0;

    const existing = await env.DB.prepare(
      `SELECT account_id, status FROM accounts WHERE github_user_id = ?`,
    )
      .bind(githubUser.id)
      .first<{ account_id: string; status: string }>();

    let accountId = existing?.account_id;
    if (existing?.status === 'suspended') {
      return redirectWithCookies('/send?auth=suspended', [
        clearOauthStateCookie(secure),
      ]);
    }

    if (accountId) {
      await env.DB.prepare(
        `UPDATE accounts
         SET github_login = ?, github_created_at = ?, public_repos = ?,
             eligible = ?, updated_at = ?
         WHERE account_id = ?`,
      )
        .bind(
          githubUser.login,
          createdAtMs,
          githubUser.public_repos,
          eligible,
          now,
          accountId,
        )
        .run();
    } else {
      accountId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO accounts (
           account_id, github_user_id, github_login, github_created_at,
           public_repos, eligible, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
        .bind(
          accountId,
          githubUser.id,
          githubUser.login,
          createdAtMs,
          githubUser.public_repos,
          eligible,
          now,
          now,
        )
        .run();
    }

    const session = await createSession(env.DB, accountId, now, secure);
    const authFlag = eligible ? 'ok' : 'ineligible';
    return redirectWithCookies(`/send?auth=${authFlag}`, [
      clearOauthStateCookie(secure),
      session.cookie,
    ]);
  } catch {
    return redirectWithCookies('/send?auth=error', [
      clearOauthStateCookie(secure),
    ]);
  }
}

export async function handleLogout(
  request: Request,
  env: AuthRouteEnv,
): Promise<Response> {
  await revokeSession(env.DB, request);
  return Response.json(
    { ok: true },
    {
      headers: {
        'set-cookie': clearSessionCookie(cookieSecure(request)),
      },
    },
  );
}

export async function handleAuthSession(
  request: Request,
  env: AuthRouteEnv,
): Promise<Response> {
  const session = await resolveSession(env.DB, request);
  if (!session) {
    return Response.json({
      signed_in: false,
      eligible: false,
      limits: {
        max_anonymous_browser_send_bytes: BROWSER_ANON_MAX_PLAINTEXT_BYTES,
        max_authenticated_browser_send_bytes: BROWSER_AUTH_MAX_PLAINTEXT_BYTES,
        daily_quota_bytes: DAILY_QUOTA_BYTES,
        weekly_quota_bytes: WEEKLY_QUOTA_BYTES,
      },
    });
  }

  const usage = await loadQuotaUsage(env.DB, session.account.account_id);
  const quota = evaluateQuota(usage, 0);

  return Response.json({
    signed_in: true,
    github_login: session.account.github_login,
    eligible: session.account.eligible === 1,
    status: session.account.status,
    limits: {
      max_anonymous_browser_send_bytes: BROWSER_ANON_MAX_PLAINTEXT_BYTES,
      max_authenticated_browser_send_bytes: BROWSER_AUTH_MAX_PLAINTEXT_BYTES,
      daily_quota_bytes: DAILY_QUOTA_BYTES,
      weekly_quota_bytes: WEEKLY_QUOTA_BYTES,
    },
    quota: {
      day_bytes: quota.day_bytes,
      week_bytes: quota.week_bytes,
      day_remaining: quota.day_remaining,
      week_remaining: quota.week_remaining,
    },
  });
}

export { resolveSession };
