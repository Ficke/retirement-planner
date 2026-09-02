import { DATABASE_MIGRATIONS } from './database';
import { runInTransaction } from './database-connection';

const MIGRATION_LOCK = 'retirement-planner-schema-migrations';

export interface MigrationOutcome {
  version: number;
  applied: string[];
}

/**
 * Bring the schema up to the highest known migration.
 *
 * Runs from CI before a deploy, never on a request path: Worker isolates are
 * created and destroyed constantly, so migrating on first use would run DDL
 * from user traffic.
 *
 * Migrations are forward-only and must be expand/contract — every one has to be
 * compatible with the previously deployed Worker, so that rolling back against
 * an already-migrated schema still works.
 */
export async function applyMigrations(
  runner: { query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> },
): Promise<MigrationOutcome> {
  return runInTransaction(runner, async (transaction) => {
    // Transaction-scoped, so a cancelled CI job releases it, and concurrent
    // runs serialize rather than race.
    await transaction.execute('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION_LOCK]);
    await transaction.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const current = await transaction.queryOne<{ version: number | null }>(
      'SELECT MAX(version) AS version FROM schema_migrations',
    );
    let version = current?.version ?? 0;
    const applied: string[] = [];

    for (const migration of DATABASE_MIGRATIONS) {
      if (migration.version <= version) continue;
      for (const sql of migration.up) {
        await transaction.execute(sql);
      }
      await transaction.execute(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
      version = migration.version;
      applied.push(`${migration.version}: ${migration.name}`);
    }

    return { version, applied };
  });
}
