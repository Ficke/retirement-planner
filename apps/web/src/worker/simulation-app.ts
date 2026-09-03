import { createEdgeApp, type EdgeEnv } from './base-app';
import { isRegisteredAccount } from './application-user';
import { durableObjectQuota } from './quota-counter';
import { edgeRustService } from './rust-service';
import { createSimulationRoutes } from './simulation-routes';

export const simulationApp = createEdgeApp();

simulationApp.route(
  '/',
  createSimulationRoutes<EdgeEnv>({
    isRegisteredAccount: (c, uid) =>
      isRegisteredAccount(uid, c.req.url, async () => {
        const db = await c.var.database();
        const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1', [uid]);
        return rows.length > 0;
      }),
    // Its own shard: a simulation budget must never serialize behind signups.
    quota: (c) => durableObjectQuota(c.env.QUOTA, 'simulation'),
    rustService: (c) => edgeRustService(c.env, c.req.url),
  }),
);
