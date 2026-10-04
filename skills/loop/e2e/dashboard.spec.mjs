// End to end: an imaginary workspace (seed.mjs) → the real dashboard server → the built UI in a
// browser. Also writes the README screenshot (docs/dashboard.png).
import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ctl from '../lib/serverctl.mjs';
import { seedDemo } from './seed.mjs';

const SCREENSHOT = fileURLToPath(new URL('../../../docs/dashboard.png', import.meta.url));
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

let dir;
let url;

test.beforeAll(async () => {
  dir = seedDemo(join(mkdtempSync(join(tmpdir(), 'myday-e2e-')), 'shop', '.my-day'));
  url = (await ctl.start(dir, { port: await freePort() })).url;
});

test.afterAll(() => ctl.stop(dir));

test('the dashboard shows the imaginary workspace and is captured for the README', async ({ page }) => {
  await page.goto(url);

  // Overview tiles.
  const tiles = page.getByRole('navigation', { name: 'Overview' });
  await expect(tiles.getByText('1 approval · 1 question')).toBeVisible();
  await expect(tiles.getByText('across 2 repos')).toBeVisible();

  // Needs you: an approval and a question, answerable in place.
  const needs = page.locator('#needs');
  await expect(needs.getByText('Rebase !112 onto main and force-push with lease?')).toBeVisible();
  await expect(needs.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(needs.getByRole('button', { name: 'Send' })).toBeVisible();

  // MR board: one card per lane.
  const board = page.locator('#mrs');
  await expect(board.locator('.lane')).toHaveCount(4);
  await expect(board.getByText('Waiting for you · q-1')).toBeVisible();
  await expect(board.getByText('Agent a1b2c3d4 working')).toBeVisible();
  await expect(board.getByText('Needs a rebase')).toBeVisible();
  await expect(board.getByText('Ready for the merge step')).toHaveCount(2);

  // Failures, reviews, agents, activity.
  await expect(page.locator('#failures').getByText('Pipeline still red after 3 attempts: flaky checkout test')).toBeVisible();
  await expect(page.locator('#reviews').getByRole('button', { name: /Mark .* reviewed/ })).toHaveCount(2);
  await expect(page.locator('#agents').getByText('1 of 3 slots busy')).toBeVisible();
  await expect(page.getByText('api-spec!25 needs your review')).toBeVisible();

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
});

test('answering a question from the dashboard closes it', async ({ page }) => {
  await page.goto(url);
  const needs = page.locator('#needs');
  await needs.getByLabel('Answer q-2').fill('Yes, read-only.');
  await needs.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('q-2 answered');
  await expect(needs.getByText('Should a wishlist be shareable')).toHaveCount(0);
});
