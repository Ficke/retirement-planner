import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  class AccountLimitError extends Error {}
  class ProfileRevisionConflictError extends Error {}
  const db = {
    initialize: vi.fn(),
    getAccountsForUser: vi.fn(),
    createAccount: vi.fn(),
    getAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    getUserProfile: vi.fn(),
    saveUserProfile: vi.fn(),
  };
  return {
    AccountLimitError,
    ProfileRevisionConflictError,
    db,
    getAuthUser: vi.fn(),
    getUnifiedDatabaseService: vi.fn(() => db),
  };
});

vi.mock('@/lib/firebase/server', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/services/server/database', () => ({
  AccountLimitError: mocks.AccountLimitError,
  ProfileRevisionConflictError: mocks.ProfileRevisionConflictError,
  getUnifiedDatabaseService: mocks.getUnifiedDatabaseService,
}));

import { GET as getAccounts, POST as createAccount } from '@/app/api/accounts/route';
import { GET as getAccount } from '@/app/api/accounts/[id]/route';
import { PUT as saveProfile } from '@/app/api/profile/route';

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
  retirementSpending: 60_000,
  retirementSpendingGrowthRate: 0.02,
  lifeExpectancy: 90,
  asOfDate: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.initialize.mockResolvedValue(undefined);
  mocks.getUnifiedDatabaseService.mockReturnValue(mocks.db);
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

    const response = await getAccount(
      new NextRequest(`http://localhost/api/accounts/${accountId}`),
      { params: Promise.resolve({ id: accountId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.db.getAccount).toHaveBeenCalledWith(accountId, owner.id);
  });

  it('injects the authenticated owner when creating an account', async () => {
    mocks.getAuthUser.mockResolvedValue(owner);
    mocks.db.createAccount.mockResolvedValue(account);
    const request = new NextRequest('http://localhost/api/accounts', {
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
    const request = new NextRequest('http://localhost/api/accounts', {
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
    const request = new NextRequest('http://localhost/api/profile', {
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
    const request = new NextRequest('http://localhost/api/profile', {
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
