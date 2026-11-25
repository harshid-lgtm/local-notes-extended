// Bundles src/ into public/app.js + public/app.css (fonts land in public/fonts/).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('public/fonts', { recursive: true, force: true });
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'public/app.js',
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  publicPath: '/',
  legalComments: 'none',
  logLevel: 'info',
});
