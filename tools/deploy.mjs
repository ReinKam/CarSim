// Publishes the simulator to GitHub Pages:  npm run deploy
// Builds the single-file version and commits it as index.html on the
// `gh-pages` branch. One file means every visitor always gets one consistent
// version (no mix of old and new files from the browser cache).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

if (git(['status', '--porcelain'])) {
  console.error('Det finnes endringer som ikke er lagret i git (commit). Lagre dem først.');
  process.exit(1);
}
execFileSync(process.execPath, [path.join(root, 'tools/build.mjs')], { stdio: 'inherit' });

const sha = git(['rev-parse', '--short', 'HEAD']);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'carsim-pages-'));
try {
  git(['fetch', 'origin', 'gh-pages']);
  git(['worktree', 'add', '--force', '-B', 'gh-pages', work, 'origin/gh-pages']);
  for (const entry of fs.readdirSync(work)) {
    if (entry !== '.git') fs.rmSync(path.join(work, entry), { recursive: true, force: true });
  }
  fs.copyFileSync(path.join(root, 'dist/carsim.html'), path.join(work, 'index.html'));
  fs.writeFileSync(path.join(work, '.nojekyll'), '');
  git(['add', '-A'], work);
  if (!git(['status', '--porcelain'], work)) {
    console.log('Ingen endring å publisere.');
  } else {
    git(['commit', '-q', '-m', `Publiser ${sha}`], work);
    git(['push', 'origin', 'gh-pages'], work);
    console.log(`Publisert ${sha} til https://reinkam.github.io/CarSim/ (klar om et minutt eller to).`);
  }
} finally {
  try {
    git(['worktree', 'remove', '--force', work]);
  } catch {
    /* ignore */
  }
}
