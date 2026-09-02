import { Client } from 'pg';
import { createDatabaseService, type UnifiedDatabaseService } from './database';
import { connectionFor, runInTransaction } from './database-connection';

export interface DatabaseSession {
  readonly db: UnifiedDatabaseService;
  /**
   * Must run for every opened session. Hyperdrive's origin connections are a
   * small fixed pool on the free plan, and un-ended clients exhaust it.
   */
  close(): Promise<void>;
}

/**
 * One client per request, for the Worker. A module-level pool would outlive
 * the isolate that built it and pin one connection string forever.
 */
export async function openDatabase(connectionString: string): Promise<DatabaseSession> {
  const client = new Client({ connectionString, application_name: 'retirement-planner-edge' });
  await client.connect();

  const connection = connectionFor(client, (run) => runInTransaction(client, run));
  return {
    db: createDatabaseService(connection),
    async close() {
      await client.end();
    },
  };
}
