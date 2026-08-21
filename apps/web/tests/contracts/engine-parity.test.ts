import { describe, expect, it } from 'vitest';
import { projectScenario } from '@/engine/projection';
import { MONTE_CARLO_DEFAULTS } from '@/data/market-history';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
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
  schemaVersion: PLAN_SCHEMA_VERSION,
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
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
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
  schemaVersion: PLAN_SCHEMA_VERSION,
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
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
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

/**
 * Spending runs past wages, so the working year draws the taxable bucket and
 * realizes gains. Nothing exercised this path before, which is how the working
 * year came to accept a capital gain and tax it at nothing.
 */
const workingShortfallPlan: SimulationPlan = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  profile: {
    birthDate: '1985-01-01',
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 45,
    currentSalary: 220_000,
    salaryGrowthRate: 0,
    currentSpending: 320_000,
    workingSpendingGrowthRate: 0,
    retirementSpending: 320_000,
    retirementSpendingGrowthRate: 0,
    lifeExpectancy: 46,
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    asOfDate: '2026-01-01',
  },
  accounts: [
    { type: 'Taxable', balance: 3_000_000, assetWeights: { stocks: 0.6, bonds: 0.4 } },
    { type: 'Traditional', balance: 500_000, assetWeights: { stocks: 0.6, bonds: 0.4 } },
  ],
  socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
  assumptions,
};

type PenalizedBucket = 'Traditional' | 'HSA';

/**
 * The same shortfall, funded from a bucket that charges a penalty before 60.
 * The penalty is cash the tax model never sees, so it has to be netted the same
 * way in both engines or the loop that sizes the draw stops somewhere else. One
 * bucket per plan, deep enough to fund every year: a draw that spilled into a
 * second bucket would split on balances, and balances follow each engine's own
 * market draws.
 */
const penaltyShortfallPlan = (bucket: PenalizedBucket): SimulationPlan => ({
  schemaVersion: PLAN_SCHEMA_VERSION,
  profile: {
    birthDate: '1986-01-01',
    state: 'TX',
    filingStatus: 'Single',
    retirementAge: 45,
    currentSalary: 50_000,
    salaryGrowthRate: 0,
    currentSpending: 120_000,
    workingSpendingGrowthRate: 0,
    retirementSpending: 120_000,
    retirementSpendingGrowthRate: 0,
    lifeExpectancy: 46,
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    asOfDate: '2026-01-01',
  },
  accounts: [{ type: bucket, balance: 5_000_000, assetWeights: { stocks: 0.6, bonds: 0.4 } }],
  socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
  assumptions,
});

const penaltyShortfallPlans: Array<{ bucket: PenalizedBucket; plan: SimulationPlan }> = [
  { bucket: 'Traditional', plan: penaltyShortfallPlan('Traditional') },
  { bucket: 'HSA', plan: penaltyShortfallPlan('HSA') },
];

/** Both spouses past 65, where the per-person senior deductions have to agree. */
const seniorCouplePlan: SimulationPlan = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  profile: {
    birthDate: '1958-01-01',
    state: 'CA',
    filingStatus: 'MarriedFilingJointly',
    retirementAge: 68,
    currentSalary: 0,
    salaryGrowthRate: 0,
    currentSpending: 0,
    workingSpendingGrowthRate: 0,
    retirementSpending: 190_000,
    retirementSpendingGrowthRate: 0,
    lifeExpectancy: 72,
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    asOfDate: '2026-01-01',
  },
  accounts: [
    { type: 'Taxable', balance: 1_500_000, assetWeights: { stocks: 0.5, bonds: 0.5 } },
    { type: 'Traditional', balance: 2_000_000, assetWeights: { stocks: 0.5, bonds: 0.5 } },
  ],
  socialSecurity: {
    enabled: true,
    claimAge: 68,
    manualOverride: true,
    estimatedBenefit: 60_000,
  },
  assumptions,
};

/**
 * An HSA-only retiree who starts before Medicare and lives past it. The single
 * bucket is deliberate: it is deep enough that no year can empty it, so every
 * draw is the tax solver's answer rather than a balance limit, and the two
 * engines stay comparable even though their market draws diverge.
 *
 * Crossing 65 moves three things at once — the premium steps down, the premium
 * joins the HSA's qualified allowance, and the 20% non-qualified penalty stops.
 */
const healthcarePlan: SimulationPlan = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  profile: {
    birthDate: '1968-01-01',
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 58,
    currentSalary: 0,
    salaryGrowthRate: 0,
    currentSpending: 0,
    workingSpendingGrowthRate: 0,
    retirementSpending: 40_000,
    retirementSpendingGrowthRate: 0,
    lifeExpectancy: 70,
    retirementHealthcare: {
      preMedicarePremium: 24_000,
      medicarePremium: 7_000,
      outOfPocket: 6_000,
      realGrowthRate: 0.02,
    },
    asOfDate: '2026-01-01',
  },
  accounts: [
    { type: 'HSA', balance: 3_000_000, assetWeights: { stocks: 0.6, bonds: 0.4 } },
  ],
  socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
  assumptions,
};

/**
 * The returns model has two sources: the TypeScript engine reads it off the
 * plan, the Rust service off the request config. Production keeps them in step
 * in services/simulation.ts, so the contract test has to as well — hardcoding
 * one here silently pointed the two engines at different market histories.
 */
function engineConfigFor(plan: SimulationPlan) {
  return {
    useHistoricalBootstrap: plan.assumptions.simulationModel !== 'parametric',
    blockSize: MONTE_CARLO_DEFAULTS.block_size,
  };
}

async function runRust(plan: SimulationPlan, paths = 1): Promise<SimulationResult> {
  const response = await fetch(new URL('/api/simulate', serviceUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan,
      config: {
        paths,
        seed: 42,
        ...engineConfigFor(plan),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Rust service returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<SimulationResult>;
}

async function runRustBatch(
  plan: SimulationPlan,
  responseMode?: 'full' | 'summary',
  paths = 20,
): Promise<unknown> {
  const response = await fetch(new URL('/api/batch', serviceUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(responseMode && { responseMode }),
      simulations: [{
        id: 'contract',
        plan,
        config: {
          paths,
          seed: 42,
          ...engineConfigFor(plan),
        },
      }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Rust batch returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Compares the fields that are a pure function of the plan. Balances are not
 * among them: the engines seed different RNGs by design, so their market draws
 * diverge even from one seed, and only the tax and cash-flow math is expected
 * to agree exactly.
 */
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
  it('keeps summary batches exact and defaults old clients to the full response', async () => {
    const fullSimulation = await runRust(withdrawalPlan, 20);
    const summary = await runRustBatch(withdrawalPlan, 'summary') as {
      results: Array<{ id: string; successProbability: number }>;
    };
    expect(summary.results).toEqual([{
      id: 'contract',
      successProbability: fullSimulation.successProbability,
    }]);

    const legacy = await runRustBatch(withdrawalPlan, undefined, 5) as {
      results: Array<{ id: string; result: SimulationResult }>;
    };
    expect(legacy.results[0].id).toBe('contract');
    expect(legacy.results[0].result.yearlyProjections.length).toBeGreaterThan(0);
  });

  it.each(penaltyShortfallPlans)(
    'penalizes an early working-year $bucket draw identically in both engines',
    async ({ bucket, plan }) => {
      const typescript = projectScenario(plan, { paths: 1, seed: 42 });
      const rust = await runRust(plan);

      const workingYear = typescript.projections[1];
      const drawn = bucket === 'Traditional'
        ? workingYear.withdrawalTraditional
        : workingYear.withdrawalHSA;
      // The fixture only means anything if the draw really was penalized.
      expect(drawn).toBeGreaterThan(0);
      expect(workingYear.age).toBeLessThan(59);
      // Salary plus the draw, less taxes and the penalty, is what got spent.
      expect(workingYear.income + drawn - workingYear.taxes)
        .toBeCloseTo(workingYear.spending, 6);
      expect(workingYear.insufficientFunds).toBe(false);

      expect(rust.successProbability).toBe(typescript.success ? 1 : 0);
      expectCashFlowParity(workingYear, rust.yearlyProjections[1], [
        'year',
        'age',
        'income',
        'spending',
        'taxes',
        'savings',
        'withdrawalTraditional',
        'withdrawalHSA',
        'insufficientFunds',
      ]);
    },
  );

  it('taxes a working-year shortfall draw identically in both engines', async () => {
    const typescript = projectScenario(workingShortfallPlan, { paths: 1, seed: 42 });
    const rust = await runRust(workingShortfallPlan);

    const workingYear = typescript.projections[1];
    // The fixture only means anything if the year really did realize a gain.
    expect(workingYear.withdrawalTaxable).toBeGreaterThan(0);
    expect(workingYear.taxes).toBeGreaterThan(0);

    expect(rust.successProbability).toBe(typescript.success ? 1 : 0);
    expectCashFlowParity(workingYear, rust.yearlyProjections[1], [
      'year',
      'age',
      'income',
      'spending',
      'taxes',
      'savings',
      'withdrawalTaxable',
      'withdrawalTraditional',
      'insufficientFunds',
    ]);
  });

  it('agrees on a household where both spouses are past 65', async () => {
    const typescript = projectScenario(seniorCouplePlan, { paths: 1, seed: 42 });
    const rust = await runRust(seniorCouplePlan);

    expect(rust.successProbability).toBe(typescript.success ? 1 : 0);
    expectCashFlowParity(typescript.projections[0], rust.yearlyProjections[0], [
      'year',
      'age',
      'taxes',
      'socialSecurityBenefit',
      'withdrawalTaxable',
      'withdrawalTraditional',
      'rmdAmount',
      'insufficientFunds',
    ]);
  });

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

  it('agrees on healthcare cost, the HSA allowance, and early-withdrawal penalties', async () => {
    const typescript = projectScenario(healthcarePlan, { paths: 1, seed: 42 });
    const rust = await runRust(healthcarePlan);

    // Ages 58 and 66: one side of the Medicare step each.
    const beforeMedicare = typescript.projections[0];
    const afterMedicare = typescript.projections[8];
    expect(beforeMedicare.age).toBe(58);
    expect(afterMedicare.age).toBe(66);

    // The fixture only means anything if the premium really did step down and
    // the pre-Medicare year really was penalized.
    expect(beforeMedicare.spending).toBeCloseTo(40_000 + 30_000, 5);
    expect(afterMedicare.spending).toBeCloseTo(
      40_000 + 13_000 * Math.pow(1.02, 8),
      5,
    );
    expect(beforeMedicare.taxes).toBeGreaterThan(afterMedicare.taxes);

    expect(rust.successProbability).toBe(typescript.success ? 1 : 0);
    for (const index of [0, 6, 7, 8, 12]) {
      expectCashFlowParity(typescript.projections[index], rust.yearlyProjections[index], [
        'year',
        'age',
        'spending',
        'taxes',
        'withdrawalHSA',
        'withdrawalTraditional',
        'insufficientFunds',
      ]);
    }
  });

  it('keeps the production 5,000-path request within a broad CI budget', async () => {
    const startedAt = performance.now();
    const result = await runRust(socialSecuritySurplusPlan, 5_000);
    const elapsedMs = performance.now() - startedAt;

    expect(result.yearlyProjections).toHaveLength(2);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
