import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const salt = Buffer.alloc(16, 7);
export const pin = '4821';
export const pinMaterial = {
  pin_salt: salt.toString('base64url'),
  pin_hash: pbkdf2Sync(pin, salt, 100_000, 32, 'sha256').toString('base64url'),
};

export function storedBody(size = 4, overrides = {}) {
  const chunkSize = 8 * 1024 * 1024;
  const count = Math.max(1, Math.ceil(size / chunkSize));
  return {
    kind: 'file', name: 'audit.txt', size, ...pinMaterial,
    chunk_count: count, chunk_plaintext_size: chunkSize,
    manifest_ciphertext_bytes: 1, ciphertext_bytes_total: 1 + size + count * 20,
    expiry_mode: '1d', encryption_mode: 'end_to_end', max_downloads: 20,
    ...overrides,
  };
}

export async function createRuntime() {
  const migrations = [];
  for (const file of (await readdir(`${root}/migrations`)).sort()) {
    migrations.push(...(await readFile(`${root}/migrations/${file}`, 'utf8'))
      .split(';').map(sql => sql.trim()).filter(Boolean));
  }
  // Test-only instrumentation executes inside workerd so tests use real D1 and R2 bindings.
  const source = `
    import worker, { LiveShareDO } from './src/index.ts';
    export { LiveShareDO };
    export default {
      async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (path === '/_test/init') {
          for (const sql of ${JSON.stringify(migrations)}) await env.DB.prepare(sql).run();
          return new Response('ok');
        }
        if (path === '/_test/sql') {
          const {sql, values = []} = await request.json();
          return Response.json(await env.DB.prepare(sql).bind(...values).all());
        }
        if (path === '/_test/objects') return Response.json(await env.STORED.list());
        if (path === '/_test/cleanup') {
          await worker.scheduled({}, env);
          return new Response('ok');
        }
        return worker.fetch(request, env);
      }
    };`;
  const { outputFiles } = await build({
    stdin: { contents: source, resolveDir: root }, bundle: true, write: false,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  });
  const mf = new Miniflare({
    host: '127.0.0.1', port: 0, modules: true, script: outputFiles[0].text,
    compatibilityDate: '2026-07-14', d1Databases: ['DB'], r2Buckets: ['STORED'],
    durableObjects: { LIVE_SHARE: { className: 'LiveShareDO', useSQLite: true } },
  });
  const request = (path, body, options = {}) => mf.dispatchFetch(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...options,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...options.headers },
    body: body === undefined ? undefined : body instanceof Uint8Array || body instanceof ReadableStream ? body : JSON.stringify(body),
  });
  const initialized = await request('/_test/init');
  assert.equal(initialized.status, 200, await initialized.text());
  return {
    mf, request,
    async sql(sql, values = []) {
      const response = await request('/_test/sql', {sql, values});
      assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
      return (await response.json()).results;
    },
    async uploadSmall(body = storedBody(), options = {}, complete = true) {
      const response = await request('/api/v1/stored', body, options);
      assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
      const share = await response.json();
      const base = '/api/v1/stored/' + share.share_id;
      const headers = { 'x-drop2-upload-token': share.upload_token };
      assert.equal((await request(base + '/manifest', new Uint8Array(1), {method:'PUT', headers})).status, 200);
      const length = body.ciphertext_bytes_total - body.manifest_ciphertext_bytes;
      assert.equal((await request(base + '/chunks/1', new Uint8Array(length), {method:'PUT', headers})).status, 200);
      if (complete) assert.equal((await request(base + '/complete', {upload_token:share.upload_token})).status, 200);
      return {...share, base};
    },
  };
}
