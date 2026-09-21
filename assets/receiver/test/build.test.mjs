import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const required = [
  'index.html',
  'styles.css',
  'app.bundle.js',
  'send.html',
  'faq.html',
  'send.css',
  'send.bundle.js',
  'notification-worker.js',
];

for (const name of required) {
  test(`dist/${name} exists after build`, () => {
    const path = join(dist, name);
    assert.ok(existsSync(path), `missing ${path} — run npm run build`);
    assert.ok(statSync(path).size > 0, `${name} is empty`);
  });
}

test('app.bundle.js contains bundled application code', async () => {
  const path = join(dist, 'app.bundle.js');
  const text = await readFile(path, 'utf8');
  assert.ok(text.length > 10_000, 'bundle too small');
});

test('stylesheets are self-contained for the offline embedded receiver', async () => {
  for (const name of ['styles.css', 'send.css']) {
    const css = await readFile(join(dist, name), 'utf8');
    assert.doesNotMatch(css, /@import\b/);
    assert.doesNotMatch(css, /url\(\s*['"]?https?:/);
    assert.ok(css.length > 1000, `${name} is missing bundled styles`);
  }
});
