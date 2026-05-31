/** User-facing API error messages — keep aligned with browser + CLI. */
export const ErrorMsg = {
  ACCESS_DENIED: 'access denied',
  SHARE_EXPIRED: 'share expired',
  SHARE_UNAVAILABLE: 'share unavailable',
  SHARE_NOT_READY: 'share not ready',
  INVALID_REQUEST: 'invalid request',
  UNAUTHORIZED: 'unauthorized',
} as const;

export type ErrorMessage = (typeof ErrorMsg)[keyof typeof ErrorMsg];

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function accessDenied(): Response {
  return jsonError(ErrorMsg.ACCESS_DENIED, 403);
}

export function shareExpired(): Response {
  return jsonError(ErrorMsg.SHARE_EXPIRED, 410);
}

export function shareUnavailable(): Response {
  return jsonError(ErrorMsg.SHARE_UNAVAILABLE, 404);
}

export function shareNotReady(): Response {
  return jsonError(ErrorMsg.SHARE_NOT_READY, 409);
}

export function unauthorized(): Response {
  return jsonError(ErrorMsg.UNAUTHORIZED, 401);
}

/** Map API error JSON to a user-visible message. */
export function userMessage(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error && typeof error === 'object' && 'error' in error) {
    const msg = (error as { error: unknown }).error;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return ErrorMsg.ACCESS_DENIED;
}
