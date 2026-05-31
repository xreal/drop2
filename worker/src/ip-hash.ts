const IP_HASH_PREFIX = 'drop2.v1.ip:';

/** Stable keyed hash for IP-derived abuse tracking. */
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`${IP_HASH_PREFIX}${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}
