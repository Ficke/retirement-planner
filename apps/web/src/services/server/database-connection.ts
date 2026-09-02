import type { SqlConnection, SqlExecutor } from './database';

const STATEMENT_TIMEOUT_MS = 15_000;

/** The one statement shape both connection kinds run inside a transaction. */
interface StatementRunner {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

function executorFor(runner: StatementRunner): SqlExecutor {
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const result = await runner.query(sql, params);
    return result.rows as T[];
  };
  return {
    query,
    async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = await query<T>(sql, params);
      return rows[0] ?? null;
    },
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      await query(sql, params);
    },
  };
}

/**
 * Run `run` inside a transaction on a single connection.
 *
 * The statement timeout is set here rather than as a connection parameter
 * because Hyperdrive pools in transaction mode and resets the connection
 * between transactions, so non-default startup parameters do not survive.
 */
export async function runInTransaction<T>(
  runner: StatementRunner,
  run: (transaction: SqlExecutor) => Promise<T>,
): Promise<T> {
  await runner.query('BEGIN', []);
  try {
    await runner.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`, []);
    const result = await run(executorFor(runner));
    await runner.query('COMMIT', []);
    return result;
  } catch (error) {
    await runner.query('ROLLBACK', []);
    throw error;
  }
}

export function connectionFor(
  runner: StatementRunner,
  transaction: SqlConnection['transaction'],
): SqlConnection {
  return { ...executorFor(runner), transaction };
}
