import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });
copyFileSync(join(root, 'notification-worker.js'), join(dist, 'notification-worker.js'));
copyFileSync(join(root, 'index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'send.html'), join(dist, 'send.html'));
copyFileSync(join(root, 'faq.html'), join(dist, 'faq.html'));
copyFileSync(join(root, 'secret.html'), join(dist, 'secret.html'));
copyFileSync(join(root, 'og.jpg'), join(dist, 'og.jpg'));
mkdirSync(join(dist, 'fonts'), { recursive: true });
copyFileSync(join(root, 'fonts/OFL.txt'), join(dist, 'fonts/OFL.txt'));
await build({
  entryPoints: [join(root, 'styles.css'), join(root, 'send.css'), join(root, 'secret.css')],
  bundle: true,
  outdir: dist,
  minify: true,
  target: ['es2020'],
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]',
});

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

await build({
  entryPoints: [join(root, 'src/secret-app.js')],
  bundle: true,
  format: 'esm',
  outfile: join(dist, 'secret.bundle.js'),
  minify: true,
  sourcemap: false,
  target: ['es2020'],
});

console.log('built receiver/send/secret dist/');
