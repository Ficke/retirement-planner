import { Hono, type Context } from 'hono';

import type { Budget, QuotaLimiter } from '@/api/quota';
import { verifyAuthToken } from '@/lib/firebase/server';
import {
  proxyToRustService,
  simulationProxyError,
  type RustServiceFetch,
} from '@/lib/simulation-proxy';

/**
 * The public simulation endpoints, served at the edge.
 *
 * Cloud Run keeps its own copy of these routes until Phase 4 retires it, and
 * the two are deliberately not shared: only one of them ever answers a given
 * deployment, and this one authenticates every request, which the origin — the
 * rollback target for browser bundles that predate it — cannot.
 */

const SIMULATION_BODY_LIMIT = 256 * 1024;
const MONTE_CARLO_TIMEOUT_MS = 30_000;
const BATCH_TIMEOUT_MS = 60_000;

/**
 * Both budgets are keyed on the verified Firebase uid, never an IP: the zone
 * WAF rule is the coarse pre-authentication shield, and an IP is shared by
 * households and rotated by attackers. The limits match what Cloud Run enforced
 * per IP, so a legitimate user sees no change.
 */
export const SIMULATION_BUDGET: Budget = { limit: 300, windowMs: 60 * 1000 };
export const SIMULATION_PATH_BUDGET: Budget = { limit: 2_000_000, windowMs: 60 * 1000 };

export type SimulationRouteEnv = { Variables: { clientIp: string } };

export interface SimulationRouteDependencies<E extends SimulationRouteEnv> {
  /** Whether a verified uid also has a row in the application `users` table. */
  isRegisteredAccount(c: Context<E>, uid: string): Promise<boolean>;
  quota(c: Context<E>): QuotaLimiter;
  rustService(c: Context<E>): RustServiceFetch;
}

/**
 * Request validation, loaded on first use.
 *
 * These schemas cost roughly 8ms of CPU to build, and a Worker charges module
 * evaluation to whichever request warms the isolate. Reaching them from inside
 * the handler keeps that off every request that is not a simulation.
 */
const validation = () => import('@/lib/validation');
const simulationRequest = () => import('@/lib/simulation-request');

function retryAfter<E extends SimulationRouteEnv>(c: Context<E>, reset: number): void {
  c.header('Retry-After', String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
}

export function createSimulationRoutes<E extends SimulationRouteEnv>(
  dependencies: SimulationRouteDependencies<E>,
): Hono<E> {
  const routes = new Hono<E>();
  const { isRegisteredAccount, quota, rustService } = dependencies;

  /**
   * Establish who is asking and charge them for the request.
   *
   * Returns the verified uid, or the response to send instead. The request
   * budget is spent before the membership lookup so a Firebase identity with no
   * account here cannot drive unbounded database queries.
   */
  async function admit(c: Context<E>): Promise<string | Response> {
    const token = await verifyAuthToken(c.req.header('authorization') ?? null);
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const limited = await quota(c).consume(`simulate:${token.uid}`, 1, SIMULATION_BUDGET);
    if (!limited.success) {
      retryAfter(c, limited.reset);
      return c.json({ error: 'Too many simulation requests. Slow down and retry shortly.' }, 429);
    }

    if (!(await isRegisteredAccount(c, token.uid))) {
      return c.json({ error: 'This account cannot use cloud compute' }, 403);
    }
    return token.uid;
  }

  async function chargePaths(
    c: Context<E>,
    uid: string,
    paths: number,
  ): Promise<Response | null> {
    const limited = await quota(c).consume(`simulate-paths:${uid}`, paths, SIMULATION_PATH_BUDGET);
    if (limited.success) return null;
    retryAfter(c, limited.reset);
    return c.json({ error: 'Simulation compute quota exceeded. Retry shortly.' }, 429);
  }

  routes.post('/api/simulation/monte-carlo', async (c) => {
    try {
      const admitted = await admit(c);
      if (admitted instanceof Response) return admitted;

      const { readLimitedJson } = await validation();
      const { monteCarloRequestSchema } = await simulationRequest();
      const parsed = monteCarloRequestSchema.safeParse(
        await readLimitedJson(c.req.raw, SIMULATION_BODY_LIMIT),
      );
      if (!parsed.success) {
        return c.json(
          { error: 'Invalid simulation request', details: parsed.error.issues.slice(0, 5) },
          400,
        );
      }

      const exhausted = await chargePaths(c, admitted, parsed.data.config.paths);
      if (exhausted) return exhausted;

      return await proxyToRustService(
        rustService(c),
        '/api/simulate',
        parsed.data,
        MONTE_CARLO_TIMEOUT_MS,
        'Simulation service unavailable',
        c.req.raw.signal,
      );
    } catch (error) {
      if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
      console.error('Simulation proxy error:', error);
      return (
        simulationProxyError(error, 'Simulation timeout') ??
        c.json({ error: 'Internal server error', details: 'Simulation failed' }, 500)
      );
    }
  });

  routes.post('/api/simulation/batch', async (c) => {
    try {
      const admitted = await admit(c);
      if (admitted instanceof Response) return admitted;

      const { readLimitedJson } = await validation();
      const { batchRequestSchema } = await simulationRequest();
      const parsed = batchRequestSchema.safeParse(
        await readLimitedJson(c.req.raw, SIMULATION_BODY_LIMIT),
      );
      if (!parsed.success) {
        return c.json(
          { error: 'Invalid batch simulation request', details: parsed.error.issues.slice(0, 5) },
          400,
        );
      }

      const totalPaths = parsed.data.simulations.reduce(
        (sum, simulation) => sum + simulation.config.paths,
        0,
      );
      const exhausted = await chargePaths(c, admitted, totalPaths);
      if (exhausted) return exhausted;

      return await proxyToRustService(
        rustService(c),
        '/api/batch',
        parsed.data,
        BATCH_TIMEOUT_MS,
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

  return routes;
}
