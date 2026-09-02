import { Pool } from 'pg';
import { createDatabaseService, type SqlConnection, type UnifiedDatabaseService } from './database';
import { connectionFor, runInTransaction } from './database-connection';

/**
 * Pooled access for the Node server. One pool per process outlives requests,
 * which is correct on Cloud Run and wrong in a Worker isolate; the Worker uses
 * database-client.ts instead.
 */
function poolConnection(pool: Pool): SqlConnection {
  return connectionFor(pool, async (run) => {
    const client = await pool.connect();
    try {
      return await runInTransaction(client, run);
    } finally {
      client.release();
    }
  });
}

let service: UnifiedDatabaseService | null = null;

export function getUnifiedDatabaseService(): UnifiedDatabaseService {
  if (service) return service;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
      'Please set it in your .env.local file or environment.',
    );
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Neon wakeup can be slow
    query_timeout: 20_000,
    statement_timeout: 15_000,
    application_name: 'retirement-planner-web',
  });

  service = createDatabaseService(poolConnection(pool));
  return service;
}
