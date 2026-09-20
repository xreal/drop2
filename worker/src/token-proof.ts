export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function tokensMatch(token: string, expectedHash: string): Promise<boolean> {
  const actual = new TextEncoder().encode(await hashToken(token));
  const expected = new TextEncoder().encode(expectedHash);
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

