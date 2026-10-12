import { defineConfig } from '@playwright/test';

/** End-to-end: loads the built Chrome extension into Chromium. Run `npm run build` first. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
