import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/contracts/**/*.test.ts'],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  envDir: './',
});
