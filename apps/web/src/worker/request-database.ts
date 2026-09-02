import { createMiddleware } from 'hono/factory';

import {
  REQUIRED_SCHEMA_VERSION,
  SchemaFloorError,
  type UnifiedDatabaseService,
} from '@/services/server/database';
import type { DatabaseSession } from '@/services/server/database-client';

export type DatabaseEnv = {
  Bindings: Env;
  Variables: { database: () => Promise<UnifiedDatabaseService> };
};

/**
 * The schema the isolate has already confirmed.
 *
 * Only a settled result is remembered, never an in-flight promise: sharing one
 * would tie later requests to the connection of the request that began it, and
 * that connection closes with its own response.
 */
let schemaVerified = false;

async function assertSchemaFloor(db: UnifiedDatabaseService): Promise<void> {
  if (schemaVerified) return;

  const { rows } = await db.query<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM schema_migrations',
  );
  const deployed = Number(rows[0]?.version ?? 0);
  if (deployed < REQUIRED_SCHEMA_VERSION) throw new SchemaFloorError(deployed);

  schemaVerified = true;
}

/**
 * Give the request a database connection whose lifetime this middleware owns.
 *
 * Acquisition and release derive from the same promise, so they cannot
 * disagree about whether a connection exists — the bug that appears when one
 * place opens and another closes. Nothing is opened for a request that never
 * asks.
 *
 * Hyperdrive's origin connections are a small fixed pool on the free plan, so a
 * client that is never ended exhausts it. Release runs after the handler, by
 * which point every response here is fully materialized JSON.
 */
export function withDatabase() {
  return createMiddleware<DatabaseEnv>(async (c, next) => {
    // Held in a cell rather than a plain binding: the acquire path assigns it
    // from inside a closure, and the release path must see that assignment.
    const cell: { session: Promise<DatabaseSession> | null } = { session: null };

    c.set('database', async () => {
      // Imported here so the proxy path, which is most traffic, never loads the
      // Postgres driver.
      const { openDatabase } = await import('@/services/server/database-client');
      cell.session ??= openDatabase(c.env.HYPERDRIVE.connectionString);
      const { db } = await cell.session;
      await assertSchemaFloor(db);
      return db;
    });

    try {
      await next();
    } finally {
      const opened = cell.session;
      if (opened) {
        c.executionCtx.waitUntil(opened.then((open) => open.close()).catch(() => undefined));
      }
    }
  });
}
