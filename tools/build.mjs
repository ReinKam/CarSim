// Builds dist/carsim.html: the whole simulator in ONE file that can be opened
// directly in Chrome (double-click), with no web server and no installation.
//   npm run build
// If data/<area>.osm.json exists it is embedded, so the file also works offline.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const data = {};
const dataDir = path.join(root, 'data');
if (fs.existsSync(dataDir)) {
  for (const file of fs.readdirSync(dataDir)) {
    const m = file.match(/^(.+)\.osm\.json$/);
    if (m) data[m[1]] = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  }
}

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const before = html;
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
html = html.replace(
  '<script type="module" src="src/main.js"></script>',
  () =>
    (Object.keys(data).length ? `<script>window.__CARSIM_DATA__=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>\n` : '') +
    `<script>${js}</script>`,
);
if (html === before || !html.includes('<script>')) throw new Error('index.html did not have the expected script tags');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/carsim.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} kB)` +
  (Object.keys(data).length ? `, map data embedded for: ${Object.keys(data).join(', ')}` : ', no map data embedded'));
