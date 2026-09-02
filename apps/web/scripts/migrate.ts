/**
 * Apply schema migrations. Usage: tsx scripts/migrate.ts
 *
 * This stays TypeScript because migration 14 interpolates PLAN_SCHEMA_VERSION,
 * which saveUserProfile also reads at runtime. A copy of that constant in a
 * plain script would let the column default drift from the code silently.
 */

import { Client } from 'pg';
import { applyMigrations } from '@/services/server/migrate';

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is required');
  }

  const client = new Client({ connectionString, application_name: 'retirement-planner-migrate' });
  await client.connect();
  try {
    const { version, applied } = await applyMigrations(client);
    for (const name of applied) console.log(`Applied migration ${name}`);
    console.log(
      applied.length === 0
        ? `Schema already at version ${version}.`
        : `Schema migrated to version ${version}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
