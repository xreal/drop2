const BASE62 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => BASE62[b % BASE62.length]).join('');
}

export function isValidShareId(id: string): boolean {
  return id.length === 6 && [...id].every((c) => BASE62.includes(c));
}
