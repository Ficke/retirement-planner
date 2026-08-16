import { describe, expect, it } from 'vitest';
import { projectScenario } from '@/engine/projection';
import type {
  PathProjection,
  SimulationPlan,
  SimulationResult,
  YearlyProjection,
} from '@/domain/types';

const serviceUrl = process.env.RUST_SERVICE_URL;
if (!serviceUrl) {
  throw new Error('RUST_SERVICE_URL is required for engine contract tests');
}

const assumptions = {
  simulationModel: 'historical' as const,
  randomSeed: 42,
  taxableGainRatio: 0.5,
  hsaEligible: false, useBackdoorRoth: false,
};

const socialSecuritySurplusPlan: SimulationPlan = {
  schemaVersion: 3,
  profile: {
    birthDate: '1959-01-01',
    state: 'TX',
    filingStatus: 'Single',
    retirementAge: 67,
    currentSalary: 0,
    salaryGrowthRate: 0,
    currentSpending: 0,
    workingSpendingGrowthRate: 0,
    retirementSpending: 0,
    retirementSpendingGrowthRate: 0,
    lifeExpectancy: 68,
    asOfDate: '2026-01-01',
  },
  accounts: [],
  socialSecurity: {
    enabled: true,
    claimAge: 67,
    manualOverride: true,
    estimatedBenefit: 36_000,
  },
  assumptions,
};

const withdrawalPlan: SimulationPlan = {
  schemaVersion: 3,
  profile: {
    birthDate: '1951-01-01',
    state: 'TX',
    filingStatus: 'Single',
    retirementAge: 75,
    currentSalary: 0,
    salaryGrowthRate: 0,
    currentSpending: 0,
    workingSpendingGrowthRate: 0,
    retirementSpending: 250_000,
    retirementSpendingGrowthRate: 0,
    lifeExpectancy: 76,
    asOfDate: '2026-01-01',
  },
  accounts: [
    {
      type: 'Taxable',
      balance: 1_000_000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    },
    {
      type: 'Traditional',
      balance: 500_000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    },
    {
      type: 'Roth',
      balance: 500_000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    },
  ],
  socialSecurity: {
    enabled: false,
    claimAge: 67,
    manualOverride: false,
  },
  assumptions,
};

const workingRmdPlan: SimulationPlan = {
  ...withdrawalPlan,
  profile: {
    ...withdrawalPlan.profile,
    retirementAge: 80,
    lifeExpectancy: 81,
    currentSalary: 100_000,
    currentSpending: 60_000,
    workingSpendingGrowthRate: 0.1,
    retirementSpending: 110_000,
    retirementSpendingGrowthRate: 0.1,
  },
};

async function runRust(plan: SimulationPlan, paths = 1): Promise<SimulationResult> {
  const response = await fetch(new URL('/api/simulate', serviceUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan,
      config: {
        paths,
        seed: 42,
        useHistoricalBootstrap: false,
        blockSize: 3,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Rust service returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<SimulationResult>;
}

function expectCashFlowParity(
  typescript: PathProjection,
  rust: YearlyProjection,
  fields: Array<keyof PathProjection>,
): void {
  for (const field of fields) {
    const typescriptValue = typescript[field];
    const rustValue = rust[field];
    if (typeof typescriptValue === 'number' && typeof rustValue === 'number') {
      expect(rustValue, field).toBeCloseTo(typescriptValue, 5);
    } else {
      expect(rustValue, field).toBe(typescriptValue);
    }
  }
}

describe('TypeScript/Rust engine contract', () => {
  it('matches exact first-year Social Security surplus cash flows', async () => {
    const typescript = projectScenario(socialSecuritySurplusPlan, { paths: 1, seed: 42 });
    const rust = await runRust(socialSecuritySurplusPlan);

    expect(rust.successProbability).toBe(typescript.success ? 1 : 0);
    expectCashFlowParity(typescript.projections[0], rust.yearlyProjections[0], [
      'year',
      'age',
      'income',
      'spending',
      'taxes',
      'socialSecurityBenefit',
      'depositTaxable',
      'portfolioValue',
      'insufficientFunds',
    ]);
  });

  it('matches retirement withdrawal, RMD, and tax semantics', async () => {
    const typescript = projectScenario(withdrawalPlan, { paths: 1, seed: 42 });
    const rust = await runRust(withdrawalPlan);

    expectCashFlowParity(typescript.projections[0], rust.yearlyProjections[0], [
      'year',
      'age',
      'spending',
      'taxes',
      'withdrawalTaxable',
      'withdrawalTraditional',
      'withdrawalRoth',
      'withdrawalHSA',
      'rmdAmount',
      'depositTaxable',
      'insufficientFunds',
    ]);
  });

  it('matches working and retirement spending phases with working-year RMDs', async () => {
    const typescript = projectScenario(workingRmdPlan, { paths: 1, seed: 42 });
    const rust = await runRust(workingRmdPlan);

    const expectedSpending = [
      60_000,
      66_000,
      72_600,
      79_860,
      87_846,
      110_000,
      121_000,
    ];
    for (const [index, spending] of expectedSpending.entries()) {
      expect(typescript.projections[index].spending).toBeCloseTo(spending, 5);
      expectCashFlowParity(
        typescript.projections[index],
        rust.yearlyProjections[index],
        ['year', 'age', 'spending'],
      );
    }
    expectCashFlowParity(typescript.projections[0], rust.yearlyProjections[0], [
      'year',
      'age',
      'income',
      'spending',
      'taxes',
      'withdrawalTraditional',
      'rmdAmount',
      'depositTaxable',
      'insufficientFunds',
    ]);
  });

  it('keeps the production 5,000-path request within a broad CI budget', async () => {
    const startedAt = performance.now();
    const result = await runRust(socialSecuritySurplusPlan, 5_000);
    const elapsedMs = performance.now() - startedAt;

    expect(result.yearlyProjections).toHaveLength(2);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
