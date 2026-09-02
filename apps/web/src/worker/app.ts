import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { createDataRoutes, type DataRouteEnv } from '@/api/data-routes';
import { INVITE_RATE_LIMIT } from '@/lib/invite-code';
import {
  REQUIRED_SCHEMA_VERSION,
  SchemaFloorError,
  type UnifiedDatabaseService,
} from '@/services/server/database';
import { openDatabase, type DatabaseSession } from '@/services/server/database-client';

type WorkerEnv = DataRouteEnv & {
  Bindings: Env;
  Variables: DataRouteEnv['Variables'] & { databaseSession: DatabaseSession };
};

/**
 * Checked once per isolate rather than once per request. A deploy that skipped
 * the migration step in CI fails closed here instead of writing against a
 * schema the code does not expect.
 */
let schemaCheck: Promise<void> | null = null;

async function assertSchemaFloor(db: UnifiedDatabaseService): Promise<void> {
  schemaCheck ??= (async () => {
    const { rows } = await db.query<{ version: number | null }>(
      'SELECT MAX(version) AS version FROM schema_migrations',
    );
    const deployed = Number(rows[0]?.version ?? 0);
    if (deployed < REQUIRED_SCHEMA_VERSION) throw new SchemaFloorError(deployed);
  })();

  try {
    await schemaCheck;
  } catch (error) {
    // A failed check must not poison the isolate for a database that has since
    // been migrated.
    schemaCheck = null;
    throw error;
  }
}

/**
 * One connection per request, opened on first use.
 *
 * Closing is the closeDatabase middleware's job, not this function's:
 * waitUntil deferred the awaiting of close(), never its invocation, so calling
 * it here closed the client before a single query ran.
 */
async function requestDatabase(c: Context<WorkerEnv>): Promise<UnifiedDatabaseService> {
  const existing = c.get('databaseSession');
  if (existing) return existing.db;

  const session = await openDatabase(c.env.HYPERDRIVE.connectionString);
  c.set('databaseSession', session);

  await assertSchemaFloor(session.db);
  return session.db;
}

export const edgeApp = new Hono<WorkerEnv>();

// The static shell carries the app's full policy from public/_headers. These
// are API responses: nothing should ever be rendered or embedded from them.
edgeApp.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }),
);

edgeApp.use('*', async (c, next) => {
  // Only cf-connecting-ip is read. Cloudflare overwrites it, while
  // x-forwarded-for is appended to and carries client-supplied values.
  c.set('clientIp', c.req.header('cf-connecting-ip')?.trim() || 'unknown');
  await next();
});

// Hyperdrive's origin connections are a small fixed pool on the free plan, so a
// client that is never ended exhausts it. Every response here is fully
// materialized JSON, so nothing is still reading from the client by this point.
edgeApp.use('*', async (c, next) => {
  try {
    await next();
  } finally {
    const session = c.get('databaseSession');
    if (session) c.executionCtx.waitUntil(session.close());
  }
});

edgeApp.route(
  '/',
  createDataRoutes<WorkerEnv>({
    getDatabase: requestDatabase,
    async limitSignup(c, key) {
      const counter = c.env.QUOTA.get(c.env.QUOTA.idFromName('signup'));
      const decision = await counter.consume(
        key,
        1,
        INVITE_RATE_LIMIT.limit,
        INVITE_RATE_LIMIT.windowMs,
      );
      return { success: decision.success, reset: decision.reset };
    },
  }),
);

edgeApp.onError((error, c) => {
  if (error instanceof SchemaFloorError) {
    console.error(error.message);
    return c.json({ error: 'Service unavailable' }, 503);
  }
  console.error('Edge request error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});
