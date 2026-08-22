import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class AccountLimitError extends Error {}
  class ProfileRevisionConflictError extends Error {}
  class RustServiceUnavailableError extends Error {}
  const db = {
    initialize: vi.fn(),
    getAccountsForUser: vi.fn(),
    createAccount: vi.fn(),
    getAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    getUserProfile: vi.fn(),
    saveUserProfile: vi.fn(),
    query: vi.fn(),
  };
  return {
    AccountLimitError,
    ProfileRevisionConflictError,
    db,
    getAuthUser: vi.fn(),
    verifyAuthToken: vi.fn(),
    getUnifiedDatabaseService: vi.fn(() => db),
    rateLimit: vi.fn(),
    fetchRustService: vi.fn(),
    RustServiceUnavailableError,
  };
});

vi.mock('@/lib/firebase/server', () => ({
  getAuthUser: mocks.getAuthUser,
  verifyAuthToken: mocks.verifyAuthToken,
}));
vi.mock('@/services/server/database', () => ({
  AccountLimitError: mocks.AccountLimitError,
  ProfileRevisionConflictError: mocks.ProfileRevisionConflictError,
  getUnifiedDatabaseService: mocks.getUnifiedDatabaseService,
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
}));
vi.mock('@/lib/rust-service-client', () => ({
  fetchRustService: mocks.fetchRustService,
  RustServiceUnavailableError: mocks.RustServiceUnavailableError,
}));

import { app } from '@/server/app';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
import { ORIGIN_SECRET_HEADER, TRUSTED_CLIENT_IP_HEADER } from '@/lib/origin-auth';

const getAccounts = () => app.request('/api/accounts');
const createAccount = (request: Request) => app.request(request);
const getAccount = (request: Request) => app.request(request);
const saveProfile = (request: Request) => app.request(request);
const runBatch = (request: Request) => app.request(request);
const runMonteCarlo = (request: Request) => app.request(request);
const runProbe = (request: Request) => app.request(request);

const owner = { id: 'firebase-owner', email: 'owner@example.test', name: null };
const accountId = '8dc6c282-ffae-4b80-874d-4ee26ecf6604';
const account = {
  id: accountId,
  name: 'Brokerage',
  institution: 'Test',
  type: 'Taxable' as const,
  balance: 100,
  assetWeights: { stocks: 0.6, bonds: 0.4 },
  taxable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const profile = {
  birthDate: '1981-01-01',
  state: 'TX',
  filingStatus: 'Single',
  retirementAge: 65,
  currentSalary: 100_000,
  salaryGrowthRate: 0.03,
  currentSpending: 50_000,
  workingSpendingGrowthRate: 0.01,
  retirementSpendingMultiplier: 1,
  retirementSpendingGrowthRate: 0.02,
  lifeExpectancy: 90,
  retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
  asOfDate: '2026-01-01',
};

async function beforeStreamClose<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Operation waited for the upstream stream to close')),
          250,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.initialize.mockResolvedValue(undefined);
  mocks.getUnifiedDatabaseService.mockReturnValue(mocks.db);
  mocks.rateLimit.mockResolvedValue({ success: true, remaining: 99, reset: Date.now() + 60_000 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cloud API authorization boundaries', () => {
  it('rejects unauthenticated account reads before touching persistence', async () => {
    mocks.getAuthUser.mockResolvedValue(null);

    const response = await getAccounts();

    expect(response.status).toBe(401);
    expect(mocks.getUnifiedDatabaseService).not.toHaveBeenCalled();
  });

  it('scopes account lists and individual reads to the Firebase UID', async () => {
    mocks.getAuthUser.mockResolvedValue(owner);
    mocks.db.getAccountsForUser.mockResolvedValue([account]);
    mocks.db.getAccount.mockResolvedValue(account);

    expect((await getAccounts()).status).toBe(200);
    expect(mocks.db.getAccountsForUser).toHaveBeenCalledWith(owner.id);

    const response = await getAccount(new Request(`http://localhost/api/accounts/${accountId}`));
    expect(response.status).toBe(200);
    expect(mocks.db.getAccount).toHaveBeenCalledWith(accountId, owner.id);
  });

  it('injects the authenticated owner when creating an account', async () => {
    mocks.getAuthUser.mockResolvedValue(owner);
    mocks.db.createAccount.mockResolvedValue(account);
    const request = new Request('http://localhost/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Brokerage',
        institution: 'Test',
        type: 'Taxable',
        balance: 100,
        stocksPct: 0.6,
        bondsPct: 0.4,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await createAccount(request);

    expect(response.status).toBe(201);
    expect(mocks.db.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Brokerage' }),
      owner.id,
    );
  });

  it('maps the transactional account cap to a conflict response', async () => {
    mocks.getAuthUser.mockResolvedValue(owner);
    mocks.db.createAccount.mockRejectedValue(new mocks.AccountLimitError('limit'));
    const request = new Request('http://localhost/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Brokerage',
        institution: 'Test',
        type: 'Taxable',
        balance: 100,
        stocksPct: 0.6,
        bondsPct: 0.4,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect((await createAccount(request)).status).toBe(409);
  });

  it('passes the owner and optimistic revision through profile writes', async () => {
    mocks.getAuthUser.mockResolvedValue(owner);
    mocks.db.saveUserProfile.mockResolvedValue(4);
    const request = new Request('http://localhost/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        profile,
        socialSecurity: {
          enabled: true,
          claimAge: 67,
          manualOverride: false,
        },
        assumptions: {
          simulationModel: 'historical',
          taxableGainRatio: 0.5,
          hsaEligible: false, useBackdoorRoth: false,
        },
        revision: 3,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await saveProfile(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 4 });
    expect(mocks.db.saveUserProfile).toHaveBeenCalledWith(
      owner.id,
      expect.objectContaining({ profile }),
      3,
    );
  });

  it('returns conflict for stale profile revisions', async () => {
    mocks.getAuthUser.mockResolvedValue(owner);
    mocks.db.saveUserProfile.mockRejectedValue(new mocks.ProfileRevisionConflictError('stale'));
    const request = new Request('http://localhost/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        profile,
        socialSecurity: { enabled: true, claimAge: 67, manualOverride: false },
        assumptions: {
          simulationModel: 'historical',
          taxableGainRatio: 0.5,
          hsaEligible: false, useBackdoorRoth: false,
        },
        revision: 2,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect((await saveProfile(request)).status).toBe(409);
  });
});

describe('simulation proxy response streaming', () => {
  const simulationPlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    profile: { ...profile, retirementSpending: 50_000 },
    accounts: [{
      type: 'Taxable',
      balance: 100_000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    }],
    socialSecurity: { enabled: true, claimAge: 67, manualOverride: false },
    assumptions: {
      simulationModel: 'historical',
      randomSeed: 42,
      taxableGainRatio: 0.5,
      hsaEligible: false,
      useBackdoorRoth: false,
    },
  };

  function simulationRequest(path: 'monte-carlo' | 'batch', body: unknown) {
    return new Request(`http://localhost/api/simulation/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const monteCarloBody = { plan: simulationPlan, config: { paths: 20, seed: 42 } };

  const batchBody = {
    responseMode: 'summary',
    simulations: [{ id: 'base', plan: simulationPlan, config: { paths: 20, seed: 42 } }],
  };

  it('allows anonymous Monte Carlo requests without touching persistence auth', async () => {
    mocks.fetchRustService.mockResolvedValue(
      Response.json({ successProbability: 0.9 }),
    );
    const response = await runMonteCarlo(simulationRequest('monte-carlo', monteCarloBody));

    expect(response.status).toBe(200);
    expect(mocks.getAuthUser).not.toHaveBeenCalled();
    expect(mocks.fetchRustService).toHaveBeenCalled();
  });

  it('allows anonymous batch requests without touching persistence auth', async () => {
    mocks.fetchRustService.mockResolvedValue(Response.json({ results: [] }));
    const response = await runBatch(simulationRequest('batch', batchBody));

    expect(response.status).toBe(200);
    expect(mocks.getAuthUser).not.toHaveBeenCalled();
    expect(mocks.fetchRustService).toHaveBeenCalled();
  });

  it('meters public simulation quota by the trusted edge client IP', async () => {
    vi.stubEnv('ORIGIN_SECRET', 'edge-secret');
    mocks.fetchRustService.mockResolvedValue(
      new Response(JSON.stringify({ successProbability: 0.9 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = simulationRequest('monte-carlo', monteCarloBody);
    request.headers.set(ORIGIN_SECRET_HEADER, 'edge-secret');
    request.headers.set(TRUSTED_CLIENT_IP_HEADER, '203.0.113.9');
    await runMonteCarlo(request);

    expect(mocks.rateLimit.mock.calls.map((call) => call[0])).toEqual([
      'simulate:203.0.113.9',
      'simulate-paths:203.0.113.9',
    ]);
  });

  it('serves the deploy probe without a user, since the pipeline has no credentials', async () => {
    mocks.fetchRustService.mockResolvedValue(
      new Response(JSON.stringify({ successProbability: 0.9, yearlyProjections: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await runProbe(
      new Request('http://localhost/api/internal/simulation-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(monteCarloBody),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.fetchRustService).toHaveBeenCalledWith('/api/simulate', expect.anything());
    await expect(response.json()).resolves.toMatchObject({ successProbability: 0.9 });
  });

  it('still clamps the probe payload, so it cannot be used as an unmetered engine', async () => {
    const response = await runProbe(
      new Request('http://localhost/api/internal/simulation-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: simulationPlan, config: { paths: 10_000_000, seed: 42 } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.fetchRustService).not.toHaveBeenCalled();
  });

  it('reports an unreachable Rust service as 503 rather than a generic 500', async () => {
    mocks.fetchRustService.mockRejectedValue(
      new mocks.RustServiceUnavailableError('Could not reach the simulation service'),
    );

    const response = await runMonteCarlo(simulationRequest('monte-carlo', monteCarloBody));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'Service unavailable' });
  });

  it('still reports an aborted upstream request as 504', async () => {
    const aborted = new Error('The operation was aborted');
    aborted.name = 'AbortError';
    mocks.fetchRustService.mockRejectedValue(aborted);

    const response = await runMonteCarlo(simulationRequest('monte-carlo', monteCarloBody));

    expect(response.status).toBe(504);
  });

  it('passes the successful headline response body through without parsing it', async () => {
    const firstChunk = new TextEncoder().encode('{"successProbability":0.75');
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const upstream = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(firstChunk);
      },
    }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    const jsonSpy = vi.spyOn(upstream, 'json');
    mocks.fetchRustService.mockResolvedValue(upstream);
    const request = new Request('http://localhost/api/simulation/monte-carlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: simulationPlan, config: { paths: 20, seed: 42 } }),
    });

    try {
      const response = await beforeStreamClose(Promise.resolve(runMonteCarlo(request)));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(jsonSpy).not.toHaveBeenCalled();

      const reader = response.body!.getReader();
      const firstRead = await beforeStreamClose(reader.read());
      expect(firstRead.done).toBe(false);
      expect(firstRead.value).toEqual(firstChunk);
      reader.releaseLock();
    } finally {
      streamController.close();
    }
  });

  it('streams the primary compact batch summary before the upstream body closes', async () => {
    const firstChunk = new TextEncoder().encode(
      '{"results":[{"id":"summary","successProbability":0.8}]}',
    );
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const upstream = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(firstChunk);
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
    mocks.fetchRustService.mockResolvedValue(upstream);
    const request = new Request('http://localhost/api/simulation/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseMode: 'summary',
        simulations: [{
          id: 'summary',
          plan: simulationPlan,
          config: { paths: 20, seed: 42 },
        }],
      }),
    });

    try {
      const response = await beforeStreamClose(Promise.resolve(runBatch(request)));
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const firstRead = await beforeStreamClose(reader.read());
      expect(firstRead.done).toBe(false);
      expect(firstRead.value).toEqual(firstChunk);
      reader.releaseLock();

      const forwarded = JSON.parse(mocks.fetchRustService.mock.calls[0][1].body as string);
      expect(forwarded.responseMode).toBe('summary');
    } finally {
      streamController.close();
    }
  });

  it('streams the legacy full batch shape and forwards the normalized default mode', async () => {
    const payload = {
      results: [{
        id: 'legacy',
        result: { successProbability: 0.75, yearlyProjections: [] },
      }],
    };
    const upstream = new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    });
    const jsonSpy = vi.spyOn(upstream, 'json');
    mocks.fetchRustService.mockResolvedValue(upstream);
    const request = new Request('http://localhost/api/simulation/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulations: [{
          id: 'legacy',
          plan: simulationPlan,
          config: { paths: 20, seed: 42 },
        }],
      }),
    });

    const response = await runBatch(request);

    expect(response.status).toBe(200);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(payload);
    const forwarded = JSON.parse(mocks.fetchRustService.mock.calls[0][1].body as string);
    expect(forwarded.responseMode).toBe('full');
  });
});
