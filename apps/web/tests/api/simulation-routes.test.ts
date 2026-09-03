import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifyAuthToken: vi.fn() }));

vi.mock('@/lib/firebase/server', () => ({ verifyAuthToken: mocks.verifyAuthToken }));

import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
import type { QuotaDecision } from '@/api/quota';
import { RustServiceUnavailableError } from '@/lib/rust-service-error';
import type { RustServiceFetch } from '@/lib/simulation-proxy';
import { createSimulationRoutes, type SimulationRouteEnv } from '@/worker/simulation-routes';

const uid = 'firebase-owner';

const simulationPlan = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  profile: {
    birthDate: '1981-01-01',
    state: 'TX',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 100_000,
    salaryGrowthRate: 0.03,
    currentSpending: 50_000,
    workingSpendingGrowthRate: 0.01,
    retirementSpending: 50_000,
    retirementSpendingMultiplier: 1,
    retirementSpendingGrowthRate: 0.02,
    lifeExpectancy: 90,
    retirementHealthcare: {
      preMedicarePremium: 0,
      medicarePremium: 0,
      outOfPocket: 0,
      realGrowthRate: 0,
    },
    longTermCare: { enabled: true, costMultiplier: 1 },
    asOfDate: '2026-01-01',
  },
  accounts: [{ type: 'Taxable', balance: 100_000, assetWeights: { stocks: 0.6, bonds: 0.4 } }],
  socialSecurity: { enabled: true, claimAge: 67, manualOverride: false },
  assumptions: {
    simulationModel: 'historical',
    randomSeed: 42,
    taxableGainRatio: 0.5,
    hsaEligible: false,
    useBackdoorRoth: false,
    rothConversion: { enabled: false, ceiling: 'bracket24' as const },
    terminalTaxRate: 0.3,
  },
};

const monteCarloBody = { plan: simulationPlan, config: { paths: 20, seed: 42 } };
const batchBody = {
  responseMode: 'summary',
  simulations: [
    { id: 'base', plan: simulationPlan, config: { paths: 20, seed: 42 } },
    { id: 'later', plan: simulationPlan, config: { paths: 30, seed: 42 } },
  ],
};

const granted: QuotaDecision = { success: true, remaining: 99, reset: Date.now() + 60_000 };

const consume = vi.fn<(key: string, cost: number) => Promise<QuotaDecision>>();
const isRegisteredAccount = vi.fn();
const rustFetch = vi.fn<RustServiceFetch>();

function app() {
  const routes = new Hono<SimulationRouteEnv & { Variables: { clientIp: string } }>();
  routes.use('*', async (c, next) => {
    c.set('clientIp', '203.0.113.9');
    await next();
  });
  return routes.route(
    '/',
    createSimulationRoutes({
      isRegisteredAccount: (_c, id) => isRegisteredAccount(id),
      quota: () => ({ consume: (key, cost) => consume(key, cost) }),
      rustService: () => rustFetch,
    }),
  );
}

function request(path: 'monte-carlo' | 'batch', body: unknown, init: RequestInit = {}) {
  return new Request(`http://localhost/api/simulation/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer id-token' },
    body: JSON.stringify(body),
    ...init,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuthToken.mockResolvedValue({ uid, emailVerified: true });
  consume.mockResolvedValue(granted);
  isRegisteredAccount.mockResolvedValue(true);
  rustFetch.mockResolvedValue(Response.json({ successProbability: 0.9 }));
});

describe('edge simulation routes', () => {
  it('proxies a simulation for a registered account', async () => {
    const response = await app().request(request('monte-carlo', monteCarloBody));

    expect(response.status).toBe(200);
    expect(rustFetch).toHaveBeenCalledWith('/api/simulate', expect.anything());
  });

  it('refuses a request that carries no Firebase identity', async () => {
    mocks.verifyAuthToken.mockResolvedValue(null);

    const response = await app().request(request('monte-carlo', monteCarloBody));

    expect(response.status).toBe(401);
    expect(rustFetch).not.toHaveBeenCalled();
  });

  // Firebase's public signup API can create an identity that never passed this
  // app's invite check, so a verified token is not membership.
  it('refuses a verified identity with no account in this application', async () => {
    isRegisteredAccount.mockResolvedValue(false);

    const response = await app().request(request('monte-carlo', monteCarloBody));

    expect(response.status).toBe(403);
    expect(rustFetch).not.toHaveBeenCalled();
  });

  it('meters both budgets on the verified account, never the client IP', async () => {
    await app().request(request('batch', batchBody));

    expect(consume.mock.calls).toEqual([
      [`simulate:${uid}`, 1],
      [`simulate-paths:${uid}`, 50],
    ]);
  });

  it('spends the request budget before it will query for membership', async () => {
    consume.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 30_000 });

    const response = await app().request(request('monte-carlo', monteCarloBody));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(isRegisteredAccount).not.toHaveBeenCalled();
  });

  it('refuses a batch that would exceed the path budget', async () => {
    consume.mockImplementation(async (_key, cost) =>
      cost > 1 ? { success: false, remaining: 0, reset: Date.now() + 20_000 } : granted,
    );

    const response = await app().request(request('batch', batchBody));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Simulation compute quota exceeded. Retry shortly.',
    });
    expect(rustFetch).not.toHaveBeenCalled();
  });

  it('rejects a payload the request schema does not accept', async () => {
    const response = await app().request(
      request('monte-carlo', { plan: simulationPlan, config: { paths: 0, seed: 42 } }),
    );

    expect(response.status).toBe(400);
    expect(rustFetch).not.toHaveBeenCalled();
  });

  // A failed token mint reports the transport error it wrapped, whose message
  // can itself contain "timeout"; answering 504 would tell the smoke check the
  // opposite of what happened.
  it.each([
    ['Could not reach the simulation service'],
    ['Could not reach Google to mint an identity token: connect timeout'],
  ])('answers 503 for an unreachable service (%s)', async (message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rustFetch.mockRejectedValue(new RustServiceUnavailableError(message));

    const response = await app().request(request('monte-carlo', monteCarloBody));

    expect(response.status).toBe(503);
  });

  it('carries the caller abort through to the upstream request', async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    rustFetch.mockImplementation(async (_path, init) => {
      upstreamSignal = init.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        upstreamSignal!.addEventListener('abort', () => {
          const aborted = new Error('The operation was aborted');
          aborted.name = 'AbortError';
          reject(aborted);
        }, { once: true });
      });
    });

    const response = app().request(
      request('monte-carlo', monteCarloBody, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    controller.abort();

    expect((await response).status).toBe(499);
  });
});
