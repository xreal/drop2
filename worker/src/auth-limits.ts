/** Shared browser auth limits and pure policy helpers (no relative imports). */

export const BROWSER_ANON_MAX_PLAINTEXT_BYTES = 10 * 1024 * 1024;
export const BROWSER_AUTH_MAX_PLAINTEXT_BYTES = 1024 * 1024 * 1024;
export const MIN_ACCOUNT_AGE_MS = 180 * 24 * 60 * 60 * 1000;
export const MIN_PUBLIC_REPOS = 2;
export const DAILY_QUOTA_BYTES = Math.floor(1.2 * 1024 * 1024 * 1024);
export const WEEKLY_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const SESSION_COOKIE = 'drop2_session';
export const OAUTH_STATE_COOKIE = 'drop2_oauth_state';
export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const GITHUB_OAUTH_SCOPES = 'read:user';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function isEligibleAccount(
  githubCreatedAtMs: number,
  publicRepos: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(githubCreatedAtMs) || githubCreatedAtMs <= 0) {
    return false;
  }
  if (!Number.isInteger(publicRepos) || publicRepos < 0) {
    return false;
  }
  const ageMs = nowMs - githubCreatedAtMs;
  return ageMs >= MIN_ACCOUNT_AGE_MS && publicRepos >= MIN_PUBLIC_REPOS;
}

export function parseGithubCreatedAt(createdAt: string): number | null {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms;
}

export interface QuotaUsage {
  day_bytes: number;
  week_bytes: number;
}

export interface QuotaCheck {
  ok: boolean;
  day_bytes: number;
  week_bytes: number;
  day_remaining: number;
  week_remaining: number;
  reason?: 'daily' | 'weekly';
}

export function startOfUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function evaluateQuota(
  usage: QuotaUsage,
  requestedBytes: number,
  dailyLimit: number = DAILY_QUOTA_BYTES,
  weeklyLimit: number = WEEKLY_QUOTA_BYTES,
): QuotaCheck {
  const dayRemaining = Math.max(0, dailyLimit - usage.day_bytes);
  const weekRemaining = Math.max(0, weeklyLimit - usage.week_bytes);
  if (requestedBytes > dayRemaining) {
    return {
      ok: false,
      day_bytes: usage.day_bytes,
      week_bytes: usage.week_bytes,
      day_remaining: dayRemaining,
      week_remaining: weekRemaining,
      reason: 'daily',
    };
  }
  if (requestedBytes > weekRemaining) {
    return {
      ok: false,
      day_bytes: usage.day_bytes,
      week_bytes: usage.week_bytes,
      day_remaining: dayRemaining,
      week_remaining: weekRemaining,
      reason: 'weekly',
    };
  }
  return {
    ok: true,
    day_bytes: usage.day_bytes,
    week_bytes: usage.week_bytes,
    day_remaining: dayRemaining,
    week_remaining: weekRemaining,
  };
}

export function weekWindowStart(nowMs: number): number {
  return nowMs - WEEK_MS;
}

export type BrowserSendGate =
  | { allow: true; accountId: string | null }
  | {
      allow: false;
      error:
        | 'auth_required'
        | 'ineligible'
        | 'account_suspended'
        | 'quota_exceeded'
        | 'file_too_large';
      status: number;
      message: string;
      limits?: Record<string, number>;
      quota?: Record<string, number>;
    };

export interface BrowserAuthContext {
  signedIn: boolean;
  eligible: boolean;
  suspended: boolean;
  accountId: string | null;
  quota: QuotaCheck | null;
}

export function evaluateBrowserSendSize(
  size: number,
  auth: BrowserAuthContext | null,
): BrowserSendGate {
  if (size > BROWSER_AUTH_MAX_PLAINTEXT_BYTES) {
    return {
      allow: false,
      error: 'file_too_large',
      status: 400,
      message: 'Browser sends are limited to 1 GiB per file.',
      limits: {
        max_authenticated_browser_send_bytes: BROWSER_AUTH_MAX_PLAINTEXT_BYTES,
      },
    };
  }

  const needsLargeTier = size > BROWSER_ANON_MAX_PLAINTEXT_BYTES;

  if (needsLargeTier && !auth?.signedIn) {
    return {
      allow: false,
      error: 'auth_required',
      status: 403,
      message: 'Sign in to share files this large on drop2.app',
      limits: {
        max_anonymous_browser_send_bytes: BROWSER_ANON_MAX_PLAINTEXT_BYTES,
        max_authenticated_browser_send_bytes: BROWSER_AUTH_MAX_PLAINTEXT_BYTES,
      },
    };
  }

  if (auth?.signedIn && auth.suspended) {
    return {
      allow: false,
      error: 'account_suspended',
      status: 403,
      message: 'This account cannot create large shares.',
    };
  }

  if (needsLargeTier && auth && !auth.eligible) {
    return {
      allow: false,
      error: 'ineligible',
      status: 403,
      message:
        'GitHub accounts must be at least 180 days old and have at least 2 public repositories to send large files.',
      limits: {
        max_anonymous_browser_send_bytes: BROWSER_ANON_MAX_PLAINTEXT_BYTES,
      },
    };
  }

  if (auth?.signedIn && auth.eligible) {
    if (!auth.quota || !auth.quota.ok) {
      const reason = auth.quota?.reason === 'weekly' ? 'weekly' : 'daily';
      return {
        allow: false,
        error: 'quota_exceeded',
        status: 403,
        message:
          reason === 'weekly'
            ? 'Weekly upload quota exceeded (2 GiB per rolling 7 days).'
            : 'Daily upload quota exceeded (1.2 GiB per UTC day).',
        quota: auth.quota
          ? {
              day_bytes: auth.quota.day_bytes,
              week_bytes: auth.quota.week_bytes,
              day_remaining: auth.quota.day_remaining,
              week_remaining: auth.quota.week_remaining,
            }
          : undefined,
        limits: {
          max_anonymous_browser_send_bytes: BROWSER_ANON_MAX_PLAINTEXT_BYTES,
          max_authenticated_browser_send_bytes: BROWSER_AUTH_MAX_PLAINTEXT_BYTES,
        },
      };
    }
  }

  return { allow: true, accountId: auth?.accountId ?? null };
}
