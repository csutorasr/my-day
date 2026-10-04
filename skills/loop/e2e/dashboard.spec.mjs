// End to end: an imaginary workspace (seed.mjs) → the real dashboard server → the built UI in a
// browser. Also writes the README screenshot (docs/dashboard.png).
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
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

  // One status line instead of KPI tiles.
  const overview = page.getByRole('navigation', { name: 'Overview' });
  await expect(overview.getByRole('link', { name: '5 things need you' })).toBeVisible();
  await expect(overview.getByRole('link', { name: '5 merge requests, 1 blocked on you' })).toBeVisible();

  // Needs you is one inbox: decisions (with the MR they are about), failures and reviews.
  const needs = page.locator('#needs');
  await expect(needs.getByText('Rebase !112 onto main and force-push with lease?')).toBeVisible();
  await expect(needs.getByText('SHOP-35: sign in with a magic link')).toBeVisible();
  await expect(needs.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(needs.getByText('Pipeline still red after 3 attempts: flaky checkout test')).toBeVisible();
  await expect(needs.getByRole('button', { name: /Mark .* reviewed/ })).toHaveCount(2);

  // MR board: one card per lane.
  const board = page.locator('#mrs');
  await expect(board.locator('.lane')).toHaveCount(4);
  await expect(board.getByText('Blocked on you')).toBeVisible();
  await expect(board.getByText('Waiting for you · q-1')).toBeVisible();
  await expect(board.getByText('Agent a1b2c3d4 working')).toBeVisible();
  await expect(board.getByText('Needs a rebase')).toBeVisible();
  await expect(board.getByText('Ready for the merge step')).toHaveCount(2);

  await expect(page.locator('#agents').getByText('1 of 3 slots busy')).toBeVisible();
  await expect(page.getByText('api-spec!25 needs your review')).toBeVisible();

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
});

test('an approval waits in the outbox and Undo sends nothing', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  const needs = page.locator('#needs');
  await needs.getByRole('button', { name: 'Approve' }).click();
  await expect(needs.getByText('Approval queued.')).toBeVisible();
  await expect(page.locator('.toasts')).toContainText('Approve q-1 in 8s');
  await expect(page.locator('#mrs')).toContainText('Your answer to q-1 is being sent');
  await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
  await expect(needs.getByRole('button', { name: 'Approve' })).toBeVisible();
  await page.clock.runFor(10_000);
  const st = await (await page.request.get(`${url}/api/state`)).json();
  assert.ok(st.questions.some((q) => q.id === 'q-1'), 'q-1 is still open after Undo');
});

test('an answer is sent when the undo window closes, and focus stays in the inbox', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  const needs = page.locator('#needs');
  await needs.getByLabel('Answer q-2').fill('Yes, read-only.');
  await needs.getByRole('button', { name: 'Send' }).click();
  await expect(needs.getByText('Answer queued.')).toBeVisible();
  // The next inbox item after the last question is the failure's Retry.
  await expect(page.locator(':focus')).toHaveText('Retry');
  await page.clock.runFor(9_000);
  await expect(page.getByRole('status').last()).toContainText('q-2 answered');
  await expect(needs.getByText('Should a wishlist be shareable')).toHaveCount(0);
});

test('the primary button stays readable in the dark theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(url);
  const ratio = await page.locator('#needs .btn.primary').first().evaluate((el) => {
    const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const st = getComputedStyle(el);
    const [a, b] = [lum(rgb(st.color)), lum(rgb(st.backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('on a phone, risky approvals and merge / rebase actions are not offered', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  const needs = page.locator('#needs');
  await expect(needs.getByText('Approve from a larger screen. You can decline here.')).toBeVisible();
  await expect(needs.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(needs.locator('[data-inbox-item="q-1"]').getByRole('button', { name: 'Decline' })).toBeVisible();
  const board = page.locator('#mrs');
  await expect(board.getByRole('button', { name: /^Merge / })).toHaveCount(0);
  await expect(board.getByRole('button', { name: /^Rebase / })).toHaveCount(0);
  await expect(board.getByRole('button', { name: /^Fix review / })).toBeVisible();
});

test('keyboard: j moves through the inbox, a approves, u undoes, ? lists the shortcuts', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  // Wait for the inbox rows, not just the panel (it renders a skeleton first).
  await page.locator('#needs [data-inbox-item]').first().waitFor();
  await page.keyboard.press('j');
  await expect(page.locator(':focus')).toHaveText('backend !112');
  await page.keyboard.press('a');
  await expect(page.locator('#needs').getByText('Approval queued.')).toBeVisible();
  await page.keyboard.press('u');
  await expect(page.locator('#needs').getByRole('button', { name: 'Approve' })).toBeVisible();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('activity names events in words and agents lead with their task', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByText('agent started').first()).toBeVisible();
  await expect(page.locator('#agents').getByText('Fixing pipeline on web !81')).toBeVisible();
});

// Last: stops the server.
test('when the server goes away the page says how old its data is', async ({ page }) => {
  await page.goto(url);
  await page.locator('#needs .ask').first().waitFor();
  await ctl.stop(dir);
  await expect(page.getByRole('alert')).toContainText('lost its connection to the loop', { timeout: 15_000 });
  await expect(page.locator('header')).toContainText('Data from');
});

