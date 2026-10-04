// Dashboard UI build. `npm run ui:dev` serves it with hot reload against a running dashboard
// server (your loop's, or the imaginary workspace from `npm run ui:demo`); `npm run ui:build`
// writes the committed bundle the dashboard server serves (server/public).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { sourceHash } from './source-hash.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../server/public', import.meta.url));
// The dashboard server to proxy to in dev (bootstrap prints its URL; 4711 is the default port).
const target = process.env.MY_DAY_URL ?? 'http://127.0.0.1:4711';
// The server only accepts POSTs from its own origin; the dev proxy drops the Vite origin instead.
const proxyTo = { target, changeOrigin: true, configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')) };

// Records the source hash next to the bundle, so a stale committed build fails `npm test`.
const stampBuild = () => ({
  name: 'my-day-build-hash',
  apply: 'build',
  closeBundle() {
    writeFileSync(`${outDir}/.build-hash`, `${sourceHash(root)}\n`);
  },
});

export default defineConfig({
  root,
  plugins: [react(), stampBuild()],
  build: { outDir, emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': proxyTo, '/health': proxyTo } },
});
