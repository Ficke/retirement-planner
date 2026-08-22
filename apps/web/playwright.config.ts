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
    // Browser smoke tests run in local/offline mode. Starting the combined
    // client + API watcher couples Vite's lifetime to the API process through
    // concurrently --kill-others, so an unrelated watcher failure can tear
    // down the page server underneath Playwright.
    command: 'pnpm dev:client',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Dependency optimization and the first Vite transform can exceed the default on CI.
    timeout: 180_000,
  },
});
