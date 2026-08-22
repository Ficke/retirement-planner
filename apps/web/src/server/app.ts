import { isIP } from 'node:net';
import { resolve } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { CreateAccountData, UpdateAccountData } from '@/domain/types';
import { CLIENT_ROUTES } from '@/lib/client-routes';
import { getAuthUser, verifyAuthToken } from '@/lib/firebase/server';
import { INVITE_RATE_LIMIT, verifyInviteCode } from '@/lib/invite-code';
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
import {
  AccountIdSchema,
  CreateAccountSchema,
  SaveProfileSchema,
  UpdateAccountSchema,
  readLimitedJson,
  validateRequest,
} from '@/lib/validation';
import {
  AccountLimitError,
  ProfileRevisionConflictError,
  getUnifiedDatabaseService,
} from '@/services/server/database';

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
        'wss://*.firebaseio.com',
      ],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc: ["'self'", 'https://*.firebaseapp.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
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

app.get('/api/profile', async (c) => {
  try {
    const user = await getAuthUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const db = getUnifiedDatabaseService();
    await db.initialize();
    return c.json(await db.getUserProfile(user.id));
  } catch (error) {
    console.error('Get profile error:', error);
    return c.json({ error: 'Failed to fetch profile' }, 500);
  }
});

app.put('/api/profile', async (c) => {
  try {
    const user = await getAuthUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const body = await readLimitedJson(c.req.raw, 64 * 1024);
    const validation = validateRequest(SaveProfileSchema, body);
    if (!validation.success) {
      return c.json({ error: 'Validation failed', errors: validation.errors }, 400);
    }

    const data = validation.data!;
    const db = getUnifiedDatabaseService();
    await db.initialize();
    const revision = await db.saveUserProfile(
      user.id,
      {
        profile: data.profile,
        socialSecurity: data.socialSecurity,
        assumptions: data.assumptions,
      },
      data.revision,
    );
    return c.json({ revision });
  } catch (error) {
    if (error instanceof ProfileRevisionConflictError) {
      return c.json(
        { error: 'Profile changed in another browser. Reload before saving again.' },
        409,
      );
    }
    if (error instanceof RangeError) return c.json({ error: error.message }, 413);
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Request body must be valid JSON' }, 400);
    }
    console.error('Save profile error:', error);
    return c.json({ error: 'Failed to save profile' }, 500);
  }
});

app.get('/api/accounts', async (c) => {
  try {
    const user = await getAuthUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const db = getUnifiedDatabaseService();
    await db.initialize();
    return c.json(await db.getAccountsForUser(user.id));
  } catch (error) {
    console.error('Get accounts error:', error);
    return c.json({ error: 'Failed to fetch accounts' }, 500);
  }
});

app.post('/api/accounts', async (c) => {
  try {
    const user = await getAuthUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const body = await readLimitedJson(c.req.raw, 64 * 1024);
    const validation = validateRequest(CreateAccountSchema, body);
    if (!validation.success) {
      return c.json({ error: 'Validation failed', errors: validation.errors }, 400);
    }

    const db = getUnifiedDatabaseService();
    await db.initialize();
    const account = await db.createAccount(validation.data as CreateAccountData, user.id);
    return c.json(account, 201);
  } catch (error) {
    if (error instanceof AccountLimitError) return c.json({ error: error.message }, 409);
    if (error instanceof RangeError) return c.json({ error: error.message }, 413);
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Request body must be valid JSON' }, 400);
    }
    console.error('Create account error:', error);
    return c.json({ error: 'Failed to create account' }, 500);
  }
});

app.get('/api/accounts/:id', async (c) => {
  try {
    const user = await getAuthUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');
    if (!AccountIdSchema.safeParse(id).success) {
      return c.json({ error: 'Invalid account ID' }, 400);
    }
    const db = getUnifiedDatabaseService();
    await db.initialize();
    const account = await db.getAccount(id, user.id);
    return account ? c.json(account) : c.json({ error: 'Account not found' }, 404);
  } catch (error) {
    console.error('Get account error:', error);
    return c.json({ error: 'Failed to fetch account' }, 500);
  }
});

app.patch('/api/accounts/:id', async (c) => {
  try {
    const user = await getAuthUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');
    if (!AccountIdSchema.safeParse(id).success) {
      return c.json({ error: 'Invalid account ID' }, 400);
    }
    const body = await readLimitedJson(c.req.raw, 64 * 1024);
    const validation = validateRequest(UpdateAccountSchema, body);
    if (!validation.success) {
      return c.json({ error: 'Validation failed', errors: validation.errors }, 400);
    }

    const db = getUnifiedDatabaseService();
    await db.initialize();
    const account = await db.updateAccount(
      id,
      user.id,
      validation.data as UpdateAccountData,
    );
    return account ? c.json(account) : c.json({ error: 'Account not found' }, 404);
  } catch (error) {
    if (error instanceof RangeError) return c.json({ error: error.message }, 413);
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Request body must be valid JSON' }, 400);
    }
    console.error('Update account error:', error);
    return c.json({ error: 'Failed to update account' }, 500);
  }
});

app.delete('/api/accounts/:id', async (c) => {
  try {
    const user = await getAuthUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');
    if (!AccountIdSchema.safeParse(id).success) {
      return c.json({ error: 'Invalid account ID' }, 400);
    }
    const db = getUnifiedDatabaseService();
    await db.initialize();
    return (await db.deleteAccount(id, user.id))
      ? c.body(null, 204)
      : c.json({ error: 'Account not found' }, 404);
  } catch (error) {
    console.error('Delete account error:', error);
    return c.json({ error: 'Failed to delete account' }, 500);
  }
});

app.post('/api/auth/sync-user', async (c) => {
  try {
    const decodedToken = await verifyAuthToken(c.req.header('authorization') ?? null);
    if (!decodedToken) return c.json({ error: 'Unauthorized' }, 401);
    if (!decodedToken.email) {
      return c.json({ error: 'Authenticated account has no email claim' }, 400);
    }

    const body = c.req.raw.body ? await readLimitedJson(c.req.raw, 16 * 1024) : undefined;
    const inviteCode =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).inviteCode
        : undefined;
    const db = getUnifiedDatabaseService();
    await db.initialize();
    const updated = await db.query(
      `UPDATE users SET email = $2, name = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [decodedToken.uid, decodedToken.email, decodedToken.name ?? null],
    );

    if (updated.rows.length === 0) {
      const limited = await rateLimit(`invite:${c.var.clientIp}`, INVITE_RATE_LIMIT);
      if (!limited.success) {
        c.header('Retry-After', String(Math.ceil((limited.reset - Date.now()) / 1000)));
        return c.json({ error: 'Too many signup attempts. Try again later.' }, 429);
      }
      if (!verifyInviteCode(inviteCode)) {
        return c.json({ error: 'That invite code is not valid' }, 403);
      }
      await db.query(
        `INSERT INTO users (id, email, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           email = $2, name = $3, updated_at = NOW()`,
        [decodedToken.uid, decodedToken.email, decodedToken.name ?? null],
      );
    }

    return c.json({ success: true, userId: decodedToken.uid });
  } catch (error) {
    if (error instanceof RangeError) return c.json({ error: error.message }, 413);
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Request body must be valid JSON' }, 400);
    }
    console.error('Sync user error:', error);
    return c.json({ error: 'Failed to sync user' }, 500);
  }
});

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
