import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist-server',
  clean: true,
  splitting: false,
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
});
