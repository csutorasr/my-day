// End to end: an imaginary workspace (seed.mjs) → the real dashboard server → the built UI in a
// browser. Also writes the README screenshots (docs/dashboard.png, docs/dashboard-loop.png).
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ctl from '../lib/serverctl.mjs';
import { seedDemo } from './seed.mjs';

const SCREENSHOT = fileURLToPath(new URL('../../../docs/dashboard.png', import.meta.url));
const SCREENSHOT_LOOP = fileURLToPath(new URL('../../../docs/dashboard-loop.png', import.meta.url));
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

let home;
let loops;
let url;
const stateOf = async (page, name) => (await (await page.request.get(`${url}/api/state?loops=${loops[name]}`)).json()).loops[0];

test.beforeAll(async () => {
  ({ home, loops } = seedDemo(mkdtempSync(join(tmpdir(), 'myday-e2e-'))));
  url = (await ctl.start(home, { port: await freePort() })).url;
});

test.afterAll(() => ctl.stop(home));

test('the inbox is the first screen and is captured for the README', async ({ page }) => {
  await page.goto(url);

  // A health strip instead of KPI tiles; the inbox count is in the tab title.
  const overview = page.getByRole('navigation', { name: 'Overview' });
  await expect(overview).toContainText('Live');
  await expect(overview.getByRole('link', { name: '6 merge requests, 2 blocked on you' })).toBeVisible();
  await expect(page).toHaveTitle('(9) my-day');
  // A source the pm loop needs is down: said once, in the health strip.
  await expect(overview.locator('[data-sources-down]')).toHaveText('Source down: voyage: intercom (login expired)');

  // Three loops run on this machine (a fourth is stopped): the filter shows them, rows say where they belong.
  await expect(page.getByRole('group', { name: 'Loops' }).getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('list', { name: 'Loops shown' }).getByRole('listitem')).toHaveCount(3);

  // Needs you is one inbox: decisions (with the MR they are about), failures and reviews.
  const needs = page.locator('#needs');
  await expect(needs.getByText('Rebase !112 onto main and force-push with lease?')).toBeVisible();
  await expect(needs.getByText('SHOP-35: sign in with a magic link')).toBeVisible();
  await expect(needs.locator(`[data-loop="${loops.shop}"]`).getByRole('button', { name: 'Approve' })).toBeVisible();
  // A draft shows what it writes where, with its text ready to edit.
  const draft = needs.locator(`[data-loop="${loops.voyage}"][data-draft]`);
  await expect(draft).toContainText('slack: post channel to #voyage-product');
  await expect(draft.getByLabel('Text to write for q-1')).toHaveValue(/^Week 40\nShipped: trip sharing/);
  await expect(needs.getByText('Pipeline still red after 3 attempts: flaky checkout test')).toBeVisible();
  await expect(needs.getByRole('button', { name: /Mark .* reviewed/ })).toHaveCount(3);
  await expect(needs.locator(`[data-loop="${loops.studio}"]`).getByText('Visual regression tests fail on the focus ring')).toBeVisible();
  await expect(needs.locator('[data-loop-badge]').first()).toHaveText('shop');

  // The loop detail waits behind the Loop button.
  await expect(page.locator('#mrs')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Loop · 2 blocked on you' })).toBeVisible();

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
});

test('the loop view opens over the inbox and is captured for the README', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Loop · 2 blocked on you' }).click();
  const loop = page.getByRole('dialog', { name: 'Loop' });
  await expect(loop).toBeVisible();
  await expect(page).toHaveURL(/#loop$/);

  // MR board: one card per lane.
  const board = loop.locator('#mrs');
  await expect(board.locator('[data-lane]')).toHaveCount(4);
  await expect(board.getByText('Blocked on you')).toBeVisible();
  await expect(board.getByRole('button', { name: /Waiting for you · q-1/ })).toBeVisible();
  await expect(board.getByText('Agent a1b2c3d4 working')).toBeVisible();
  await expect(board.getByText('Needs a rebase')).toBeVisible();
  await expect(board.getByText('Ready for the merge step')).toHaveCount(2);
  await expect(loop.locator('#agents').getByText('2 of 3 slots busy')).toBeVisible();

  await page.screenshot({ path: SCREENSHOT_LOOP });
});

test('the loop view: l and Esc toggle it, focus returns, #loop survives a reload, Back closes it', async ({ page }) => {
  await page.goto(url);
  await page.locator('#needs [data-inbox-item]').first().waitFor();
  const loop = page.getByRole('dialog', { name: 'Loop' });

  await page.keyboard.press('j');
  await expect(page.locator(':focus')).toHaveText('backend !112');
  await page.keyboard.press('l');
  await expect(loop).toBeVisible();
  // Inbox keys pause while the loop view covers the inbox.
  await page.keyboard.press('a');
  await expect(page.locator('#needs').getByText('Approval queued.')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(loop).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveText('backend !112');

  await page.keyboard.press('l');
  await page.reload();
  await expect(loop).toBeVisible();
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  await expect(loop).toHaveCount(0);
  await expect(page).not.toHaveURL(/#loop/);

  await page.getByRole('link', { name: '6 merge requests, 2 blocked on you' }).click();
  await expect(loop).toBeVisible();
  await page.goBack();
  await expect(loop).toHaveCount(0);
});

test('waiting for you on an MR card leads to that question in the inbox', async ({ page }) => {
  await page.goto(`${url}/#loop`);
  await page.getByRole('dialog', { name: 'Loop' }).getByRole('button', { name: /Waiting for you · q-1/ }).click();
  await expect(page.getByRole('dialog', { name: 'Loop' })).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveText('backend !112');
  await expect(page.locator(':focus').locator('xpath=ancestor::*[@data-inbox-item][1]')).toHaveAttribute('data-inbox-item', 'q-1');
});

test('an approval waits in the outbox and Undo sends nothing', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  const needs = page.locator('#needs');
  const shopApprove = needs.locator(`[data-loop="${loops.shop}"]`).getByRole('button', { name: 'Approve' });
  await shopApprove.click();
  await expect(needs.getByText('Approval queued.')).toBeVisible();
  await expect(page.locator('[data-toasts]')).toContainText('Approve q-1 in 8s');
  // Focus moved on to the next inbox item (an answer field), so open the loop view with the button.
  await page.getByRole('button', { name: /^Loop/ }).click();
  await expect(page.locator('#mrs')).toContainText('Your answer to q-1 is being sent');
  // The undo toast stays above the loop view.
  await page.locator('[data-toasts]').getByRole('button', { name: 'Undo' }).click();
  await expect(shopApprove).toBeVisible();
  await page.clock.runFor(10_000);
  const st = await stateOf(page, 'shop');
  assert.ok(st.questions.some((q) => q.id === 'q-1'), 'q-1 is still open after Undo');
});

test('an answer is sent when the undo window closes, and focus stays in the inbox', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  const needs = page.locator('#needs');
  await needs.getByLabel('Answer q-2').fill('Yes, read-only.');
  await needs.locator(`[data-loop="${loops.shop}"][data-inbox-item="q-2"]`).getByRole('button', { name: 'Send' }).click();
  await expect(needs.getByText('Answer queued.')).toBeVisible();
  // Focus moves on to the next inbox item: studio's question, its answer field.
  await expect(needs.locator(`[data-loop="${loops.studio}"]`).getByLabel('Answer q-1')).toBeFocused();
  await page.clock.runFor(9_000);
  await expect(page.getByRole('status').last()).toContainText('q-2 answered');
  await expect(needs.getByText('Should a wishlist be shareable')).toHaveCount(0);
});

test("waiting for you on another loop's MR card leads to that loop's question, not the one with the same id", async ({ page }) => {
  await page.goto(`${url}/#loop`);
  const loop = page.getByRole('dialog', { name: 'Loop' });
  await loop.getByRole('group', { name: 'Loop shown' }).getByRole('button', { name: 'studio' }).click();
  await loop.getByRole('button', { name: /Waiting for you · q-1/ }).click();
  await expect(loop).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveText('ui !9');
  await expect(page.locator(':focus').locator('xpath=ancestor::*[@data-inbox-item][1]')).toHaveAttribute('data-loop', loops.studio);
});

test('a loop whose workspace is gone says so instead of loading forever', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'myday-e2e-gone-'));
  const gone = seedDemo(root, { only: ['archive'] });
  rmSync(join(root, 'archive'), { recursive: true, force: true });
  const { url: goneUrl } = await ctl.start(gone.home, { port: await freePort() });
  try {
    await page.goto(goneUrl);
    await expect(page.getByRole('alert')).toContainText('No loop can be shown');
    await expect(page.getByRole('alert')).toContainText('archive: no store at');
  } finally {
    await ctl.stop(gone.home);
  }
});

test('a broken loop is listed next to the filter with its error', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'myday-e2e-broken-'));
  const two = seedDemo(root, { only: ['shop', 'archive'] });
  rmSync(join(root, 'archive'), { recursive: true, force: true });
  const { url: twoUrl } = await ctl.start(two.home, { port: await freePort() });
  try {
    await page.goto(twoUrl);
    await page.locator('#needs [data-inbox-item]').first().waitFor();
    await expect(page.locator('[data-loop-broken]')).toContainText('archive');
    await expect(page.locator('[data-loop-broken]')).toContainText('no store at');
  } finally {
    await ctl.stop(two.home);
  }
});

test('Show stopped adds the stopped loop to the filter; choosing it shows its inbox', async ({ page }) => {
  await page.goto(url);
  const filter = page.getByRole('group', { name: 'Loops' });
  await expect(filter.getByRole('button')).toHaveCount(3);
  await page.getByRole('switch', { name: 'Show stopped' }).click();
  await expect(filter.getByRole('button')).toHaveCount(4);
  await filter.getByRole('button', { name: /archive/ }).click();
  await expect(page.getByRole('list', { name: 'Loops shown' }).getByRole('listitem')).toHaveCount(4);
  await expect(page.locator('[data-loop-row]').filter({ hasText: 'archive' })).toContainText('Stopped');
  // The choice is remembered per browser; put it back for the next tests.
  await page.reload();
  await expect(filter.getByRole('button')).toHaveCount(4);
  await filter.getByRole('button', { name: /archive/ }).click();
  await page.getByRole('switch', { name: 'Show stopped' }).click();
  await expect(filter.getByRole('button')).toHaveCount(3);
});

test('a review marked done goes to the workspace it belongs to, although both use the same id', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  const row = page.locator(`#needs [data-loop="${loops.studio}"][data-inbox-item="review-1"]`);
  await row.getByRole('button', { name: /Mark .* reviewed/ }).click();
  await page.clock.runFor(9_000);
  await expect(row).toHaveCount(0);
  assert.deepEqual((await stateOf(page, 'studio')).reviews.map((r) => r.id), []);
  assert.ok((await stateOf(page, 'shop')).reviews.some((r) => r.id === 'review-1'), "shop's review-1 is untouched");
});

test('a machine with one loop shows no filter, as before several loops', async ({ page }) => {
  const one = seedDemo(mkdtempSync(join(tmpdir(), 'myday-e2e-one-')), { only: ['shop'] });
  const { url: oneUrl } = await ctl.start(one.home, { port: await freePort() });
  try {
    await page.goto(oneUrl);
    await page.locator('#needs [data-inbox-item]').first().waitFor();
    await expect(page.locator('[data-loop-filter]')).toHaveCount(0);
    await expect(page.locator('[data-loop-badge]')).toHaveCount(0);
    await expect(page.getByRole('banner')).toContainText('shop');
    await expect(page).toHaveTitle('(5) my-day');
  } finally {
    await ctl.stop(one.home);
  }
});

test('the primary button stays readable in the dark theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(url);
  const ratio = await page.locator('#needs [data-primary]').first().evaluate((el) => {
    // Computed colours can be oklch(); let a canvas resolve them to sRGB.
    const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
    const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
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
  await expect(needs.locator(`[data-loop="${loops.shop}"]`).getByRole('button', { name: 'Approve' })).toHaveCount(0);
  // A draft (a message, a comment) may be approved on the go.
  await expect(needs.locator(`[data-loop="${loops.voyage}"][data-draft]`).getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(needs.locator(`[data-loop="${loops.shop}"][data-inbox-item="q-1"]`).getByRole('button', { name: 'Decline' })).toBeVisible();
  // Phones get the inbox only: no loop view, even from a #loop link.
  await expect(page.getByRole('button', { name: /^Loop/ })).toHaveCount(0);
  await page.goto(`${url}/#loop`);
  await expect(needs.locator('[data-inbox-item]').first()).toBeVisible();
  await expect(page.locator('#mrs')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Overview' }).getByRole('link')).toHaveCount(0);
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
  // Focus moved on to the next item's answer field; Esc leaves it so the next key is a shortcut.
  await page.keyboard.press('Escape');
  await page.keyboard.press('u');
  await expect(page.locator(`#needs [data-loop="${loops.shop}"]`).getByRole('button', { name: 'Approve' })).toBeVisible();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('a draft approved with edits is written as edited; Reset brings back the loop\'s text', async ({ page }) => {
  await page.clock.install();
  await page.goto(url);
  const draft = page.locator(`#needs [data-loop="${loops.voyage}"][data-draft]`);
  const text = draft.getByLabel('Text to write for q-1');
  await text.fill('Week 40\nShipped: trip sharing.');
  await expect(draft.getByRole('button', { name: 'Approve edited' })).toBeVisible();
  await draft.getByRole('button', { name: 'Reset' }).click();
  await expect(text).toHaveValue(/Risk: map pins overlap/);
  await text.fill('Week 40\nShipped: trip sharing.');
  await draft.getByRole('button', { name: 'Approve edited' }).click();
  await expect(draft.getByText('Approval queued.')).toBeVisible();
  await page.clock.runFor(9_000);
  await expect(draft).toHaveCount(0);
  assert.equal((await stateOf(page, 'voyage')).questions.length, 0);
  const sum = await (await page.request.get(`${url}/api/loops/${loops.voyage}/summary?today=1`)).json();
  const answer = sum.events.find((e) => e.kind === 'dashboard-answer');
  assert.equal(answer.data.draft.body, 'Week 40\nShipped: trip sharing.');
  assert.match(answer.message, /q-1 approved on dashboard \(edited\)/);
});

test('a claude -p run shows its repo in the chain, and Stop run waits in the outbox', async ({ page }) => {
  await page.goto(`${url}/#loop`);
  const run = page.locator('#agents [data-agent="bug-1"]');
  await expect(run).toContainText('backend (2 of 2)');
  await expect(run).toContainText('claude -p since');
  await run.getByRole('button', { name: /^Stop run/ }).click();
  await expect(run.getByRole('button', { name: 'Undo stop run' })).toBeVisible();
  await run.getByRole('button', { name: 'Undo stop run' }).click();
  await expect(run.getByRole('button', { name: /^Stop run/ })).toBeVisible();
});

test('activity names events in words and agents lead with their task', async ({ page }) => {
  await page.goto(`${url}/#loop`);
  await expect(page.getByText('agent started').first()).toBeVisible();
  await expect(page.locator('#agents').getByText('Fixing pipeline on web !81')).toBeVisible();
});

// Last: stops the server.
test('when the server goes away the page says how old its data is', async ({ page }) => {
  await page.goto(url);
  await page.locator('#needs [data-inbox-item]').first().waitFor();
  await ctl.stop(home);
  await expect(page.getByRole('alert')).toContainText('lost its connection to the loop', { timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: 'Overview' })).toContainText('Offline · data from');
});

