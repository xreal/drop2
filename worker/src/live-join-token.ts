export const JOIN_TOKEN_TTL_MS = 90_000;

export function issueJoinToken(now: number, token: string): {
  joinToken: string;
  joinTokenExpiresAt: number;
} {
  return {
    joinToken: token,
    joinTokenExpiresAt: now + JOIN_TOKEN_TTL_MS,
  };
}

export function isJoinTokenValid(
  providedToken: string,
  expectedToken: string | null,
  expiresAt: number | null,
  now: number,
): boolean {
  if (!expectedToken || providedToken !== expectedToken) {
    return false;
  }
  if (!expiresAt) {
    return false;
  }
  return now <= expiresAt;
}

export function clearJoinToken(state: {
  join_token: string | null;
  join_token_expires_at: number | null;
}): void {
  state.join_token = null;
  state.join_token_expires_at = null;
}
