import { isIP } from 'node:net';
import { resolve } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { createDataRoutes } from '@/api/data-routes';
import { CLIENT_ROUTES } from '@/lib/client-routes';
import { INVITE_RATE_LIMIT } from '@/lib/invite-code';
import {
  ORIGIN_SECRET_HEADER,
  TRUSTED_CLIENT_IP_HEADER,
  originSecretCandidates,
  verifyOriginSecret,
} from '@/lib/origin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { proxyToRustService, simulationProxyError } from '@/lib/simulation-proxy';
import {
  SIMULATION_PATH_RATE_LIMIT,
  SIMULATION_RATE_LIMIT,
  batchRequestSchema,
  monteCarloRequestSchema,
} from '@/lib/simulation-request';
import { readLimitedJson } from '@/lib/validation';
import { getUnifiedDatabaseService } from '@/services/server/database-pool';

type AppEnvironment = {
  Variables: {
    clientIp: string;
    originAuthenticated: boolean;
  };
};

export const app = new Hono<AppEnvironment>();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: [
        "'self'",
        'https://*.googleapis.com',
        'https://*.firebaseio.com',
        'https://*.firebaseapp.com',
        'https://*.google-analytics.com',
        'https://*.analytics.google.com',
        'https://www.googletagmanager.com',
        'wss://*.firebaseio.com',
      ],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc: ["'self'", 'https://*.firebaseapp.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://www.googletagmanager.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'", 'blob:'],
    },
    crossOriginOpenerPolicy: 'same-origin-allow-popups',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }),
);

app.use('*', async (c, next) => {
  await next();
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  c.header('X-Frame-Options', 'DENY');
});

app.use('*', async (c, next) => {
  if (c.req.path === '/healthz') {
    c.set('clientIp', 'unknown');
    c.set('originAuthenticated', false);
    await next();
    return;
  }

  const currentSecret = process.env.ORIGIN_SECRET ?? '';
  const previousSecret = process.env.ORIGIN_SECRET_PREVIOUS ?? '';
  const hasOriginSecret = originSecretCandidates(currentSecret, previousSecret).length > 0;

  if (!hasOriginSecret) {
    if (process.env.NODE_ENV === 'production') {
      return c.text('Service unavailable', 503);
    }

    c.set('clientIp', 'unknown');
    c.set('originAuthenticated', false);
    await next();
    return;
  }

  const authenticated = verifyOriginSecret(
    c.req.header(ORIGIN_SECRET_HEADER) ?? null,
    currentSecret,
    previousSecret,
  );
  if (!authenticated) return c.text('Forbidden', 403);

  const forwardedClientIp = c.req.header(TRUSTED_CLIENT_IP_HEADER)?.trim() ?? '';
  c.set('clientIp', isIP(forwardedClientIp) === 0 ? 'unknown' : forwardedClientIp);
  c.set('originAuthenticated', true);
  await next();
});

app.get('/healthz', (c) => c.json({ status: 'ok' }));

app.route(
  '/',
  createDataRoutes({
    // The pool outlives the request on Cloud Run, so there is nothing to close.
    getDatabase: async () => getUnifiedDatabaseService(),
    limitSignup: (_c, key) => rateLimit(key, INVITE_RATE_LIMIT),
  }),
);

async function handleSimulation(c: Context<AppEnvironment>) {
  const limited = await rateLimit(`simulate:${c.var.clientIp}`, SIMULATION_RATE_LIMIT);
  if (!limited.success) {
    c.header('Retry-After', String(Math.ceil((limited.reset - Date.now()) / 1000)));
    return c.json({ error: 'Too many simulation requests. Slow down and retry shortly.' }, 429);
  }

  const body = await readLimitedJson(c.req.raw, 256 * 1024);
  const validation = monteCarloRequestSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid simulation request', details: validation.error.issues.slice(0, 5) },
      400,
    );
  }
  const pathLimit = await rateLimit(
    `simulate-paths:${c.var.clientIp}`,
    SIMULATION_PATH_RATE_LIMIT,
    validation.data.config.paths,
  );
  if (!pathLimit.success) {
    c.header('Retry-After', String(Math.ceil((pathLimit.reset - Date.now()) / 1000)));
    return c.json({ error: 'Simulation compute quota exceeded. Retry shortly.' }, 429);
  }
  return proxyToRustService(
    '/api/simulate',
    validation.data,
    30_000,
    'Simulation service unavailable',
    c.req.raw.signal,
  );
}

app.post('/api/simulation/monte-carlo', async (c) => {
  try {
    return await handleSimulation(c);
  } catch (error) {
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    console.error('Simulation proxy error:', error);
    return (
      simulationProxyError(error, 'Simulation timeout') ??
      c.json({ error: 'Internal server error', details: 'Simulation failed' }, 500)
    );
  }
});

app.post('/api/simulation/batch', async (c) => {
  try {
    const limited = await rateLimit(`simulate:${c.var.clientIp}`, SIMULATION_RATE_LIMIT);
    if (!limited.success) {
      c.header('Retry-After', String(Math.ceil((limited.reset - Date.now()) / 1000)));
      return c.json({ error: 'Too many simulation requests. Slow down and retry shortly.' }, 429);
    }

    const body = await readLimitedJson(c.req.raw, 256 * 1024);
    const validation = batchRequestSchema.safeParse(body);
    if (!validation.success) {
      return c.json(
        { error: 'Invalid batch simulation request', details: validation.error.issues.slice(0, 5) },
        400,
      );
    }
    const totalPaths = validation.data.simulations.reduce(
      (sum, simulation) => sum + simulation.config.paths,
      0,
    );
    const pathLimit = await rateLimit(
      `simulate-paths:${c.var.clientIp}`,
      SIMULATION_PATH_RATE_LIMIT,
      totalPaths,
    );
    if (!pathLimit.success) {
      c.header('Retry-After', String(Math.ceil((pathLimit.reset - Date.now()) / 1000)));
      return c.json({ error: 'Simulation compute quota exceeded. Retry shortly.' }, 429);
    }
    return await proxyToRustService(
      '/api/batch',
      validation.data,
      60_000,
      'Batch simulation service unavailable',
      c.req.raw.signal,
    );
  } catch (error) {
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    console.error('Batch simulation proxy error:', error);
    return (
      simulationProxyError(error, 'Batch simulation timeout') ??
      c.json({ error: 'Internal server error', details: 'Batch simulation failed' }, 500)
    );
  }
});

app.post('/api/internal/simulation-probe', async (c) => {
  try {
    const limited = await rateLimit(`simulation-probe:${c.var.clientIp}`, SIMULATION_RATE_LIMIT);
    if (!limited.success) {
      c.header('Retry-After', String(Math.ceil((limited.reset - Date.now()) / 1000)));
      return c.json({ error: 'Too many probe requests. Slow down and retry shortly.' }, 429);
    }
    const body = await readLimitedJson(c.req.raw, 256 * 1024);
    const validation = monteCarloRequestSchema.safeParse(body);
    if (!validation.success) {
      return c.json(
        { error: 'Invalid simulation request', details: validation.error.issues.slice(0, 5) },
        400,
      );
    }
    return await proxyToRustService(
      '/api/simulate',
      validation.data,
      30_000,
      'Simulation service unavailable',
      c.req.raw.signal,
    );
  } catch (error) {
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    console.error('Simulation probe error:', error);
    return (
      simulationProxyError(error, 'Simulation timeout') ??
      c.json({ error: 'Internal server error', details: 'Simulation probe failed' }, 500)
    );
  }
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

if (process.env.NODE_ENV === 'production') {
  const staticRoot = resolve(process.cwd(), 'dist');
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', serveStatic({ root: staticRoot }));
  const serveClientShell = serveStatic({
    root: staticRoot,
    rewriteRequestPath: () => '/index.html',
  });
  for (const clientRoute of Object.values(CLIENT_ROUTES)) {
    app.get(clientRoute, serveClientShell);
  }
}

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  console.error('Unhandled request error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});
