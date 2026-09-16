import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedBytes, readJsonObject } from './request-body.ts';

test('body limits count actual streamed bytes without trusting Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('http://localhost', {method:'PUT', body:stream, duplex:'half', headers:{'content-length':'1'}});
  assert.equal(await readBoundedBytes(request, 10), null);
  assert.equal(cancelled, true);
});

test('JSON controls require a bounded object body', async () => {
  for (const value of ['null', '[]', '"text"', 'x'.repeat(16 * 1024 + 1)]) {
    assert.equal(await readJsonObject(new Request('http://localhost', {method:'POST', body:value})), null);
  }
  assert.deepEqual(await readJsonObject(new Request('http://localhost', {method:'POST', body:'{"pin":"1234"}'})), {pin:'1234'});
});
