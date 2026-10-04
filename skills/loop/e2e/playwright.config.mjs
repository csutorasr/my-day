import { defineConfig } from '@playwright/test';

// Uses the locally installed Google Chrome; set PW_CHANNEL= (empty) to use Playwright's own
// Chromium instead (`npx playwright install chromium` first).
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  // Tests share one seeded server; run them in file order.
  workers: 1,
  reporter: 'list',
  use: {
    ...(channel ? { channel } : {}),
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    // 24-hour times and a fixed zone keep the README screenshot stable.
    locale: 'en-GB',
    timezoneId: 'Europe/Budapest',
  },
});
