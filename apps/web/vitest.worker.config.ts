import { fileURLToPath, URL } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Miniflare refuses to start a Hyperdrive binding without a local origin, even
// for tests that never open a connection. These exercise the proxy and the
// request plumbing; the data routes are tested against their dependencies in
// tests/api.
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??=
  'postgresql://retire_worker:local-only@127.0.0.1:5432/neondb';

// The Worker runs on workerd, not jsdom, so it needs its own pool and cannot
// join the default project's config.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/worker/**/*.test.ts'],
  },
});
