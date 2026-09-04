import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    exclude: ['**/contracts/**', '**/e2e/**', '**/worker/**', '**/node_modules/**'],
    // Vitest owns *.test.ts and Playwright owns *.spec.ts. Splitting on the
    // suffix rather than the directory means a new Playwright directory cannot
    // be picked up here by accident, which tests/e2e-worker was.
    include: ['tests/**/*.test.{js,ts}'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  envDir: './',
});
