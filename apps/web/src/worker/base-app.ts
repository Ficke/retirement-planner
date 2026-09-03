import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { SchemaFloorError } from '@/services/server/database';
import { withDatabase, type DatabaseEnv } from './request-database';

export type EdgeEnv = {
  Bindings: Env;
  Variables: { clientIp: string } & DatabaseEnv['Variables'];
};

/**
 * A Hono app with the middleware every edge API subsystem needs.
 *
 * Each subsystem builds its own app on top and is reached through a dynamic
 * import, so a request pays only for the module graph it uses. This module is
 * the part they share, and holds nothing that costs meaningful CPU to evaluate.
 */
export function createEdgeApp(): Hono<EdgeEnv> {
  const app = new Hono<EdgeEnv>();

  // The static shell carries the app's full policy from public/_headers. These
  // are API responses: nothing should ever be rendered or embedded from them.
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      referrerPolicy: 'strict-origin-when-cross-origin',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    }),
  );

  app.use('*', async (c, next) => {
    // Only cf-connecting-ip is read. Cloudflare overwrites it, while
    // x-forwarded-for is appended to and carries client-supplied values.
    c.set('clientIp', c.req.header('cf-connecting-ip')?.trim() || 'unknown');
    await next();
  });

  app.use('*', withDatabase());

  app.onError((error, c) => {
    if (error instanceof SchemaFloorError) {
      console.error(error.message);
      return c.json({ error: 'Service unavailable' }, 503);
    }
    console.error('Edge request error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
