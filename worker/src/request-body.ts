const MAX_JSON_BYTES = 16 * 1024;

export async function readBoundedBytes(request: Request, maximum: number): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maximum) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await readBoundedBytes(request, MAX_JSON_BYTES);
    if (!bytes) return null;
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
