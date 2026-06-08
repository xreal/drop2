import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });
copyFileSync(join(root, 'index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'send.html'), join(dist, 'send.html'));
copyFileSync(join(root, 'faq.html'), join(dist, 'faq.html'));
copyFileSync(join(root, 'styles.css'), join(dist, 'styles.css'));
copyFileSync(join(root, 'send.css'), join(dist, 'send.css'));

await build({
  entryPoints: [join(root, 'src/app.js')],
  bundle: true,
  format: 'esm',
  outfile: join(dist, 'app.bundle.js'),
  minify: true,
  sourcemap: false,
  target: ['es2020'],
});

await build({
  entryPoints: [join(root, 'src/send-app.js')],
  bundle: true,
  format: 'esm',
  outfile: join(dist, 'send.bundle.js'),
  minify: true,
  sourcemap: false,
  target: ['es2020'],
});

console.log('built receiver/send dist/');
