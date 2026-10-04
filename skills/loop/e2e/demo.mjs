// `npm run ui:demo`: seeds the imaginary workspaces and home into a temp folder and runs the real dashboard
// server on it (port 4712). Pair it with `npm run ui:dev:demo` for hot reload against it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ctl from '../lib/serverctl.mjs';
import { seedDemo } from './seed.mjs';

const { home } = seedDemo(mkdtempSync(join(tmpdir(), 'myday-demo-')));
const { url } = await ctl.start(home, { port: Number(process.env.PORT ?? 4712) });
console.log(`Imaginary machine home ${home}\nDashboard ${url}  (Ctrl+C stops it)`);
const stop = async () => { await ctl.stop(home); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
