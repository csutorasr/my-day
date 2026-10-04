// Hash of everything that feeds the dashboard build. `vite build` stamps it into
// server/public/.build-hash; a test recomputes it to catch UI edits committed without a rebuild.
// Dependency-free so the test runs without installing Vite.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_DIR = fileURLToPath(new URL('.', import.meta.url));
const INPUTS = ['index.html', 'vite.config.js', 'package.json', 'jsconfig.json', 'components.json', 'src', 'public'];

function files(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).sort().flatMap((name) => files(join(path, name)));
}

export function sourceHash(dir = UI_DIR) {
  const h = createHash('sha256');
  for (const input of INPUTS) {
    for (const file of files(join(dir, input))) {
      h.update(relative(dir, file).split(sep).join('/'));
      // Normalise line endings so a checkout with CRLF hashes the same.
      h.update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    }
  }
  return h.digest('hex');
}
