import { DATABASE_MIGRATIONS } from './database';
import { runInTransaction } from './database-connection';

const MIGRATION_LOCK = 'retirement-planner-schema-migrations';

export interface MigrationOutcome {
  version: number;
  applied: string[];
}

export interface MigrationOptions {
  /**
   * Runtime role to grant table access to after migrating.
   *
   * Tables this migration role creates are owned by it, and ALTER DEFAULT
   * PRIVILEGES can only be set by the creating role, so a new table would
   * otherwise be invisible to the Worker until someone remembered to grant it.
   * Granting here keeps a new table usable in the same step that creates it.
   */
  grantTo?: string;
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
  options: MigrationOptions = {},
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

    if (options.grantTo) {
      // Identifier, not a value, so it cannot be a bound parameter. Reject
      // anything that is not a plain role name rather than quote it.
      if (!/^[a-z_][a-z0-9_]*$/.test(options.grantTo)) {
        throw new Error(`Invalid role name: ${options.grantTo}`);
      }
      await transaction.execute(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, users, user_profiles TO ${options.grantTo}`,
      );
      await transaction.execute(`GRANT SELECT ON schema_migrations TO ${options.grantTo}`);
    }

    return { version, applied };
  });
}
