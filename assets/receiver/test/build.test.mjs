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
  'secret.html',
  'secret.css',
  'secret.bundle.js',
  'og.jpg',
  'fonts/Geist-Variable.woff2',
  'fonts/GeistMono-Variable.woff2',
  'fonts/OFL.txt',
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
  for (const name of ['styles.css', 'send.css', 'secret.css']) {
    const css = await readFile(join(dist, name), 'utf8');
    assert.doesNotMatch(css, /@import\b/);
    assert.doesNotMatch(css, /url\(\s*['"]?https?:/);
    assert.ok(css.length > 1000, `${name} is missing bundled styles`);
  }
});

test('secret.bundle.js stays free of the file-transfer crypto stack', async () => {
  const text = await readFile(join(dist, 'secret.bundle.js'), 'utf8');
  assert.ok(text.length < 15_000, `secret bundle grew to ${text.length} bytes`);
  assert.doesNotMatch(text, /xchacha/i);
});

test('every font a stylesheet references ships in dist', async () => {
  for (const name of ['styles.css', 'secret.css']) {
    const css = await readFile(join(dist, name), 'utf8');
    const fonts = [...css.matchAll(/url\("?\.\/(fonts\/[^")]+)"?\)/g)].map((match) => match[1]);
    assert.ok(fonts.length >= 2, `${name} should load Geist and Geist Mono`);
    for (const font of fonts) assert.ok(existsSync(join(dist, font)), `${name} references missing ${font}`);
  }
});
