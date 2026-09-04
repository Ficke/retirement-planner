import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

/**
 * The default e2e config runs against the Vite dev server, which has no asset
 * manifest, no Worker, and no versions — so it cannot see the behavior a deploy
 * depends on. These specs run against the built client behind the real Worker,
 * which is what production serves.
 */
export default defineConfig({
  testDir: './tests/e2e-worker',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build:edge && pnpm exec wrangler dev --port ${PORT} --inspector-port 0`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reused, unlike the dev-server suite. The command builds, so an
    // already-running Worker is serving an older build -- which is the exact
    // condition these specs exist to detect, and it would make them pass
    // against code they never loaded.
    reuseExistingServer: false,
    // A Wasm check, two Vite builds, and workerd's first start.
    timeout: 300_000,
    env: {
      // Miniflare will not start a Hyperdrive binding without one. Nothing here
      // opens a connection.
      WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
        'postgresql://retire_worker:local-only@127.0.0.1:5432/neondb',
    },
  },
});
