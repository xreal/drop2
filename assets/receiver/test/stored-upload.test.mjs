import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStoredUpload } from '../src/stored-upload.js';

function testFile(name, contents) {
  const bytes = new TextEncoder().encode(contents);
  return {
    name,
    size: bytes.length,
    slice(start, end) {
      return new Blob([bytes.slice(start, end)]);
    },
  };
}

test('prepareStoredUpload creates PIN material by default', async () => {
  const prepared = await prepareStoredUpload(testFile('report.txt', 'hello'));

  assert.match(prepared.pin, /^\d{4}$/);
  assert.notEqual(prepared.createBody.pin_salt, '');
  assert.notEqual(prepared.createBody.pin_hash, '');
});

test('prepareStoredUpload supports a share without a PIN', async () => {
  const prepared = await prepareStoredUpload(testFile('report.txt', 'hello'), {
    pinRequired: false,
  });

  assert.equal(prepared.pin, null);
  assert.equal(prepared.createBody.pin_salt, '');
  assert.equal(prepared.createBody.pin_hash, '');
});

test('prepareStoredUpload creates a PIN-protected plaintext quick link', async () => {
  const prepared = await prepareStoredUpload(testFile('note.txt', 'quick contents'), {
    quickLink: true,
    pinRequired: false,
  });

  assert.match(prepared.pin, /^\d{4}$/);
  assert.equal(prepared.capability, null);
  assert.equal(prepared.createBody.encryption_mode, 'none');
  assert.equal(prepared.createBody.expiry_mode, 'quick');
  assert.equal(prepared.createBody.max_downloads, 20);
  assert.deepEqual(prepared.chunks[0], new TextEncoder().encode('quick contents'));
});

test('prepareStoredUpload rejects files over the configured max', async () => {
  await assert.rejects(
    () =>
      prepareStoredUpload(testFile('big.bin', 'x'.repeat(11)), {
        maxPlaintextBytes: 10,
      }),
    /limited/,
  );
});

test('prepareStoredUpload packages zip entries as kind folder', async () => {
  const prepared = await prepareStoredUpload(new Blob(), {
    kind: 'folder',
    displayName: 'files.zip',
    zipEntries: [
      { path: 'a.txt', blob: new Blob([new TextEncoder().encode('alpha')]) },
      { path: 'b.txt', blob: new Blob([new TextEncoder().encode('beta')]) },
    ],
    maxPlaintextBytes: 1024 * 1024,
  });

  assert.equal(prepared.kind, 'folder');
  assert.equal(prepared.fileName, 'files.zip');
  assert.equal(prepared.createBody.kind, 'folder');
  assert.equal(prepared.createBody.name, 'files.zip');
  assert.equal(prepared.createBody.encryption_mode, 'end_to_end');
  assert.ok(prepared.size > 0);
});

test('prepareStoredUpload rejects quick links for folders', async () => {
  await assert.rejects(
    () =>
      prepareStoredUpload(new Blob(), {
        quickLink: true,
        kind: 'folder',
        displayName: 'files.zip',
        zipEntries: [{ path: 'a.txt', blob: new Blob([new TextEncoder().encode('a')]) }],
      }),
    /Quick links are only available for single files/,
  );
});