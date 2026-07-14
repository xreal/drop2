import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_ZIP_MAX_ENTRIES,
  buildStoreZip,
  crc32,
  normalizeArchivePath,
  uniqueArchivePaths,
} from '../src/zip-store.js';

test('buildStoreZip creates a readable STORE zip', async () => {
  const zip = await buildStoreZip([
    { path: 'a.txt', blob: new Blob([new TextEncoder().encode('hello')]) },
    { path: 'dir/b.txt', blob: new Blob([new TextEncoder().encode('world')]) },
  ]);

  assert.equal(zip.name, 'files.zip');
  assert.ok(zip.size > 0);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(indexOfSequence(bytes, [0x50, 0x4b, 0x05, 0x06]) >= 0, true);
  assert.equal(indexOfSequence(bytes, new TextEncoder().encode('a.txt')) >= 0, true);
  assert.equal(indexOfSequence(bytes, new TextEncoder().encode('dir/b.txt')) >= 0, true);
  assert.equal(indexOfSequence(bytes, new TextEncoder().encode('hello')) >= 0, true);
  assert.equal(indexOfSequence(bytes, new TextEncoder().encode('world')) >= 0, true);
});

test('buildStoreZip rejects too many entries', async () => {
  const entries = Array.from({ length: BROWSER_ZIP_MAX_ENTRIES + 1 }, (_, i) => ({
    path: `f${i}.txt`,
    blob: new Blob([new TextEncoder().encode('x')]),
  }));
  await assert.rejects(() => buildStoreZip(entries), /limited to 500/);
});

test('buildStoreZip rejects oversized archives early', async () => {
  await assert.rejects(
    () =>
      buildStoreZip([{ path: 'big.bin', blob: new Blob([new Uint8Array(20)]) }], {
        maxBytes: 10,
      }),
    /limited/,
  );
});

test('normalizeArchivePath blocks traversal and empty paths', () => {
  assert.equal(normalizeArchivePath('a/b.txt'), 'a/b.txt');
  assert.throws(() => normalizeArchivePath('../x'), /Invalid/);
  assert.throws(() => normalizeArchivePath(''), /Invalid/);
});

test('uniqueArchivePaths disambiguates collisions', () => {
  assert.deepEqual(uniqueArchivePaths(['a.txt', 'a.txt', 'b.txt']), [
    'a.txt',
    'a (1).txt',
    'b.txt',
  ]);
});

test('crc32 matches known vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

function indexOfSequence(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
