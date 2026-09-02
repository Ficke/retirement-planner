import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { createDataRoutes, type DataRouteEnv } from '@/api/data-routes';
import { INVITE_RATE_LIMIT } from '@/lib/invite-code';
import { SchemaFloorError } from '@/services/server/database';
import { durableObjectQuota } from './quota-counter';
import { withDatabase, type DatabaseEnv } from './request-database';

type WorkerEnv = {
  Bindings: Env;
  Variables: DataRouteEnv['Variables'] & DatabaseEnv['Variables'];
};

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

edgeApp.use('*', withDatabase());

edgeApp.route(
  '/',
  createDataRoutes<WorkerEnv>({
    getDatabase: (c) => c.var.database(),
    signupQuota: (c) => durableObjectQuota(c.env.QUOTA, 'signup'),
    signupBudget: INVITE_RATE_LIMIT,
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
