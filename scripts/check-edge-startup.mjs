#!/usr/bin/env node
/**
 * Guard the Worker's startup cost.
 *
 * A Worker parses and executes its entry module before serving, and that work
 * is charged to whichever request happens to warm the isolate. On the Workers
 * Free plan that request has 10ms of CPU, so anything pulled into the entry
 * graph is paid by traffic that may never use it.
 *
 * Measured with `wrangler check startup`: building the domain schemas alone
 * costs ~8ms and the whole data subsystem ~15ms, against ~0ms for the entry as
 * it stands. Each subsystem below is therefore reached through a dynamic
 * import and must stay in its own chunk.
 *
 * This checks the built output rather than the source, because a stray static
 * import anywhere in the graph would undo the split without touching the
 * dynamic import that expresses the intent.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, so the check behaves the same from the repo root or
// from the workspace it inspects.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = join(REPO_ROOT, 'apps/web/dist/retire_plan_edge');
const ENTRY = join(WORKER_DIR, 'index.js');

/** Marker strings that only appear if the subsystem is in the entry graph. */
const MUST_BE_LAZY = [
  { name: 'zod validation schemas', markers: ['_zod', 'superRefine'] },
  { name: 'Postgres driver', markers: ['pg-protocol', 'DatabaseError'] },
  { name: 'Hono application', markers: ['secureHeaders'] },
];

const ENTRY_BUDGET_BYTES = 32 * 1024;

let failed = false;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  failed = true;
};

let entry;
try {
  entry = readFileSync(ENTRY, 'utf8');
} catch {
  console.error(`No build at ${ENTRY}. Run \`pnpm build:edge\` first.`);
  process.exit(1);
}

const size = statSync(ENTRY).size;
if (size > ENTRY_BUDGET_BYTES) {
  fail(`entry chunk is ${(size / 1024).toFixed(1)} KiB, over the ${ENTRY_BUDGET_BYTES / 1024} KiB budget`);
}

for (const { name, markers } of MUST_BE_LAZY) {
  const found = markers.filter((marker) => entry.includes(marker));
  if (found.length > 0) {
    fail(`${name} is in the entry chunk (matched ${found.join(', ')}) — it must load on first use`);
  }
}

// A split that produced no lazy chunks would pass the checks above vacuously.
const chunks = readdirSync(join(WORKER_DIR, 'assets')).filter((f) => f.endsWith('.js'));
if (chunks.length < 3) {
  fail(`expected the subsystems to split into separate chunks, found ${chunks.length}`);
}

if (failed) process.exit(1);
console.log(
  `Edge startup budget met: entry ${(size / 1024).toFixed(1)} KiB, ` +
  `${chunks.length} lazily loaded chunks.`,
);
