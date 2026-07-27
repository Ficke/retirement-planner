import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Chromium only. These are smoke tests over app wiring, not rendering
  // fidelity, so a second and third engine buys little for the CI minutes and
  // the browser downloads. Add firefox/webkit here if that changes — and
  // install them in the e2e job in .github/workflows/test.yml at the same time.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Cold Turbopack compile on a CI runner takes well over the 60s default.
    timeout: 180_000,
  },
});
