#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rustRoot = join(root, 'rust-simulation-service');
const wasmRoot = join(root, 'apps/web/src/wasm');
const hashPath = join(wasmRoot, 'source.sha256');
const write = process.argv.includes('--write');
const artifactFiles = [
  'package.json',
  'retirement_simulation.d.ts',
  'retirement_simulation.js',
  'retirement_simulation_bg.wasm',
  'retirement_simulation_bg.wasm.d.ts',
  'source.sha256',
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'target' ? [] : sourceFiles(path);
    return entry.name.endsWith('.rs') && !['main.rs', 'server.rs'].includes(entry.name)
      ? [path]
      : [];
  });
}

const inputs = [
  join(root, 'package.json'),
  join(root, 'rust-toolchain.toml'),
  join(rustRoot, 'Cargo.toml'),
  join(rustRoot, 'Cargo.lock'),
  ...sourceFiles(join(rustRoot, 'src')),
].sort();
const hash = createHash('sha256');
for (const path of inputs) {
  hash.update(relative(root, path));
  hash.update('\0');
  hash.update(readFileSync(path));
  hash.update('\0');
}
const expected = `${hash.digest('hex')}\n`;

if (write) {
  const generatedIgnorePath = join(wasmRoot, '.gitignore');
  if (existsSync(generatedIgnorePath)) unlinkSync(generatedIgnorePath);
  writeFileSync(hashPath, expected);
  console.log(`Recorded Wasm source hash ${expected.trim()}`);
} else {
  const current = readFileSync(hashPath, 'utf8');
  if (current !== expected) {
    throw new Error('The committed Wasm artifact is stale. Run pnpm wasm:build and commit it.');
  }
}

const generatedFiles = readdirSync(wasmRoot).sort();
if (JSON.stringify(generatedFiles) !== JSON.stringify(artifactFiles)) {
  throw new Error(`Unexpected Wasm package files: ${generatedFiles.join(', ')}`);
}
for (const file of artifactFiles) readFileSync(join(wasmRoot, file));
if (!write) console.log(`Wasm artifact matches Rust source ${expected.trim()}`);
