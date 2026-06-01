import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const required = [
  'index.html',
  'styles.css',
  'app.bundle.js',
  'send.html',
  'send.css',
  'send.bundle.js',
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
  const text = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
  assert.ok(text.length > 10_000, 'bundle too small');
});
