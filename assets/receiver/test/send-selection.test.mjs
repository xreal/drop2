import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSelections, selectionFromFiles } from '../src/send-selection.js';

function fakeFile(name, contents, webkitRelativePath = '') {
  const bytes = new TextEncoder().encode(contents);
  const file = new File([bytes], name, { type: 'text/plain' });
  if (webkitRelativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: webkitRelativePath });
  }
  return file;
}

test('selectionFromFiles keeps a single file as kind file', () => {
  const selection = selectionFromFiles([fakeFile('note.txt', 'hi')]);
  assert.equal(selection.mode, 'file');
  assert.equal(selection.kind, 'file');
  assert.equal(selection.displayName, 'note.txt');
  assert.equal(selection.fileCount, 1);
});

test('selectionFromFiles packages multiple files as files.zip', () => {
  const selection = selectionFromFiles([
    fakeFile('a.txt', 'a'),
    fakeFile('b.txt', 'b'),
  ]);
  assert.equal(selection.mode, 'archive');
  assert.equal(selection.kind, 'folder');
  assert.equal(selection.displayName, 'files.zip');
  assert.equal(selection.fileCount, 2);
  assert.equal(selection.entries.length, 2);
});

test('selectionFromFiles packages directory picks as folder.zip', () => {
  const selection = selectionFromFiles(
    [
      fakeFile('one.txt', '1', 'docs/one.txt'),
      fakeFile('two.txt', '2', 'docs/nested/two.txt'),
    ],
    { fromDirectory: true },
  );
  assert.equal(selection.mode, 'archive');
  assert.equal(selection.kind, 'folder');
  assert.equal(selection.displayName, 'docs.zip');
  assert.deepEqual(
    selection.entries.map((entry) => entry.path),
    ['docs/one.txt', 'docs/nested/two.txt'],
  );
});

test('selectionFromFiles rejects empty picks', () => {
  assert.throws(() => selectionFromFiles([fakeFile('empty.txt', '')]), /Empty/);
});

test('mergeSelections appends dropped files one by one', () => {
  const first = selectionFromFiles([fakeFile('a.txt', 'a')]);
  const second = selectionFromFiles([fakeFile('b.txt', 'b')]);
  const merged = mergeSelections(first, second);

  assert.equal(merged.mode, 'archive');
  assert.equal(merged.origin, 'files');
  assert.equal(merged.displayName, 'files.zip');
  assert.equal(merged.fileCount, 2);
  assert.deepEqual(
    merged.entries.map((entry) => entry.path),
    ['a.txt', 'b.txt'],
  );
});

test('mergeSelections keeps appending onto an archive', () => {
  const start = selectionFromFiles([fakeFile('a.txt', 'a'), fakeFile('b.txt', 'b')]);
  const merged = mergeSelections(start, selectionFromFiles([fakeFile('c.txt', 'c')]));
  assert.equal(merged.fileCount, 3);
  assert.deepEqual(
    merged.entries.map((entry) => entry.path),
    ['a.txt', 'b.txt', 'c.txt'],
  );
});

test('mergeSelections replaces when a folder is involved', () => {
  const files = selectionFromFiles([fakeFile('a.txt', 'a')]);
  const folder = selectionFromFiles(
    [fakeFile('one.txt', '1', 'docs/one.txt')],
    { fromDirectory: true },
  );
  assert.equal(mergeSelections(files, folder).origin, 'folder');
  assert.equal(mergeSelections(folder, files).origin, 'file');
});
