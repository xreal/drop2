import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_ANON_MAX_PLAINTEXT_BYTES,
  BROWSER_AUTH_MAX_PLAINTEXT_BYTES,
  DAILY_QUOTA_BYTES,
  MIN_ACCOUNT_AGE_MS,
  MIN_PUBLIC_REPOS,
  WEEKLY_QUOTA_BYTES,
  evaluateBrowserSendSize,
  evaluateQuota,
  isEligibleAccount,
  parseGithubCreatedAt,
  startOfUtcDay,
} from './auth-limits.ts';

const DAY = 24 * 60 * 60 * 1000;

test('isEligibleAccount requires age and public repos', () => {
  const now = Date.UTC(2026, 6, 14);
  const oldEnough = now - MIN_ACCOUNT_AGE_MS;
  assert.equal(isEligibleAccount(oldEnough, MIN_PUBLIC_REPOS, now), true);
  assert.equal(isEligibleAccount(oldEnough + DAY, MIN_PUBLIC_REPOS, now), false);
  assert.equal(isEligibleAccount(oldEnough, MIN_PUBLIC_REPOS - 1, now), false);
});

test('parseGithubCreatedAt accepts ISO timestamps', () => {
  const ms = parseGithubCreatedAt('2015-01-15T12:00:00Z');
  assert.equal(ms, Date.parse('2015-01-15T12:00:00Z'));
  assert.equal(parseGithubCreatedAt('not-a-date'), null);
});

test('startOfUtcDay returns midnight UTC', () => {
  const now = Date.parse('2026-07-14T15:30:00Z');
  assert.equal(startOfUtcDay(now), Date.parse('2026-07-14T00:00:00Z'));
});

test('evaluateQuota allows remaining capacity', () => {
  const check = evaluateQuota({ day_bytes: 0, week_bytes: 0 }, 100);
  assert.equal(check.ok, true);
  assert.equal(check.day_remaining, DAILY_QUOTA_BYTES);
  assert.equal(check.week_remaining, WEEKLY_QUOTA_BYTES);
});

test('evaluateQuota blocks daily overflow', () => {
  const used = DAILY_QUOTA_BYTES - 10;
  const check = evaluateQuota({ day_bytes: used, week_bytes: used }, 20);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'daily');
});

test('evaluateQuota blocks weekly overflow when daily still has room', () => {
  const check = evaluateQuota(
    { day_bytes: 0, week_bytes: WEEKLY_QUOTA_BYTES - 5 },
    10,
  );
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'weekly');
});

const eligibleAuth = {
  signedIn: true,
  eligible: true,
  suspended: false,
  accountId: 'acc-1',
  quota: {
    ok: true,
    day_bytes: 0,
    week_bytes: 0,
    day_remaining: 1000,
    week_remaining: 2000,
  },
};

test('anonymous can send up to 10 MiB', () => {
  const gate = evaluateBrowserSendSize(BROWSER_ANON_MAX_PLAINTEXT_BYTES, null);
  assert.equal(gate.allow, true);
});

test('anonymous over 10 MiB requires auth', () => {
  const gate = evaluateBrowserSendSize(BROWSER_ANON_MAX_PLAINTEXT_BYTES + 1, null);
  assert.equal(gate.allow, false);
  if (!gate.allow) assert.equal(gate.error, 'auth_required');
});

test('ineligible signed-in cannot send over 10 MiB', () => {
  const gate = evaluateBrowserSendSize(BROWSER_ANON_MAX_PLAINTEXT_BYTES + 1, {
    ...eligibleAuth,
    eligible: false,
  });
  assert.equal(gate.allow, false);
  if (!gate.allow) assert.equal(gate.error, 'ineligible');
});

test('eligible within quota can send up to 1 GiB', () => {
  const gate = evaluateBrowserSendSize(BROWSER_AUTH_MAX_PLAINTEXT_BYTES, eligibleAuth);
  assert.equal(gate.allow, true);
  if (gate.allow) assert.equal(gate.accountId, 'acc-1');
});

test('over 1 GiB is rejected', () => {
  const gate = evaluateBrowserSendSize(BROWSER_AUTH_MAX_PLAINTEXT_BYTES + 1, eligibleAuth);
  assert.equal(gate.allow, false);
  if (!gate.allow) assert.equal(gate.error, 'file_too_large');
});

test('quota exceeded returns quota_exceeded', () => {
  const gate = evaluateBrowserSendSize(100, {
    ...eligibleAuth,
    quota: {
      ok: false,
      reason: 'daily',
      day_bytes: 1,
      week_bytes: 1,
      day_remaining: 0,
      week_remaining: 0,
    },
  });
  assert.equal(gate.allow, false);
  if (!gate.allow) assert.equal(gate.error, 'quota_exceeded');
});
