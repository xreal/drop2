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
