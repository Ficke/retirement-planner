/**
 * Simulation orchestration.
 *
 * Scenario construction (which seeds to use, how many paths, which plan fields
 * each sweep varies) lives here so native and WebAssembly adapters receive the
 * same work. The values swept come from domain/levers.ts, which the Plan page's
 * sliders and curves share.
 */

import { runMonteCarloSimulation, runMonteCarloSummaries } from '@/engine/mc';
import { retirementSpendingOf } from '@/domain/age';
import {
  SIMULATION_EXPORT_SCHEMA_ID,
  SIMULATION_EXPORT_SCHEMA_VERSION,
  simulationExportSchema,
  type SimulationExport,
} from '@/domain/simulation-export';
import {
  DATA_FIRST_YEAR,
  DATA_LAST_YEAR,
  MONTE_CARLO_BLOCK_SIZE,
  STOCK_BOND_CORRELATION,
  US_BOND_REAL_RETURNS,
  US_INFLATION,
  US_STOCK_REAL_RETURNS,
} from '@/data/market-history';
import { TAX_LAW_YEAR } from '@/data/tax-brackets-2025';
import { HEALTHCARE_PREMIUM_RULES_YEAR } from '@/data/healthcare-premiums';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
import { simulationResultSchema } from '@/domain/schemas';
import { CONVERSION_STEPS, leverRange } from '@/domain/levers';
import type {
  RetirementPlan,
  SimulationPlan,
  SimulationResult,
  SimulationSummary,
  SSAnalysisResult,
  SpendingAnalysisResult,
  RetirementAgeAnalysisResult,
  RothConversionAnalysisResult
} from '@/domain/types';

export interface SimulationService {
  runMainSimulation(plan: RetirementPlan, useServerSide?: boolean, signal?: AbortSignal): Promise<SimulationResult>;
  runSocialSecurityAnalysis(plan: RetirementPlan, useServerSide?: boolean, signal?: AbortSignal): Promise<SSAnalysisResult[]>;
  runSpendingAnalysis(plan: RetirementPlan, useServerSide?: boolean, signal?: AbortSignal): Promise<SpendingAnalysisResult[]>;
  runRetirementAgeAnalysis(plan: RetirementPlan, useServerSide?: boolean, signal?: AbortSignal): Promise<RetirementAgeAnalysisResult[]>;
  runSensitivityAnalyses(plan: RetirementPlan, useServerSide?: boolean, signal?: AbortSignal): Promise<SensitivityAnalysisResults>;
}

export interface SensitivityAnalysisResults {
  socialSecurity: SSAnalysisResult[];
  spending: SpendingAnalysisResult[];
  retirementAge: RetirementAgeAnalysisResult[];
  rothConversion: RothConversionAnalysisResult[];
}

export const MAIN_PATHS = 5000;
// The headline and every sensitivity scenario share one root seed, so path i
// draws the same market returns at every grid point. That makes sampling error
// common-mode along a curve: the shape stays readable at path counts far below
// what an absolute probability would need. The main simulation, not these
// curves, is what reports the headline number.
export const SWEEP_PATHS = 1000;

interface Scenario {
  id: string;
  plan: RetirementPlan;
  paths: number;
  seed: number;
}

interface BatchSimulationResponse {
  id: string;
  successProbability?: number;
  /** This supports rolling deployments against Rust services that predate summary responses. */
  result?: Pick<SimulationResult, 'successProbability'>;
}

/** Build the minimal transient plan accepted by the Rust engine. */
export function toSimulationPlan(plan: RetirementPlan): SimulationPlan {
  const profile = { ...plan.profile, retirementSpending: retirementSpendingOf(plan.profile) };
  delete (profile as Partial<typeof plan.profile>).retirementSpendingMultiplier;
  return {
    ...plan,
    schemaVersion: PLAN_SCHEMA_VERSION,
    profile,
    accounts: plan.accounts.map((account) => ({
      type: account.type,
      balance: account.balance,
      assetWeights: { ...account.assetWeights },
    })),
  };
}

/** A reproducible, privacy-trimmed record of one completed headline run. */
export function buildSimulationExport(
  plan: RetirementPlan,
  result: SimulationResult,
  exportedAt = new Date(),
): SimulationExport {
  const output = simulationResultSchema.parse({
    successProbability: result.successProbability,
    medianTerminalWealth: result.medianTerminalWealth,
    medianAfterTaxTerminalWealth: result.medianAfterTaxTerminalWealth,
    percentile5TerminalWealth: result.percentile5TerminalWealth,
    percentile10TerminalWealth: result.percentile10TerminalWealth,
    percentile90TerminalWealth: result.percentile90TerminalWealth,
    yearlyProjections: result.yearlyProjections,
    outcomeBuckets: result.outcomeBuckets,
    riskOfRuin: result.riskOfRuin,
  });
  return simulationExportSchema.parse({
    schema: {
      id: SIMULATION_EXPORT_SCHEMA_ID,
      version: SIMULATION_EXPORT_SCHEMA_VERSION,
      compatibility: 'Reject unsupported major versions; ignore unknown additive fields.',
    },
    exportedAt: exportedAt.toISOString(),
    privacy: {
      containsSensitiveFinancialData: true,
      omittedAccountFields: ['id', 'name', 'institution'],
    },
    units: {
      currency: 'USD',
      monetaryValues: `real dollars as of ${plan.profile.asOfDate}`,
      ratesAndAssetWeights: 'decimal fractions',
      probabilities: 'decimal fractions from 0 to 1',
      ages: 'completed years',
      periods: 'calendar years',
    },
    engine: {
      kernel: 'retirement-simulation-rust',
      adapter: result.source ?? 'unknown',
      kernelVersion: result.engineVersion ?? null,
      sourceRevision: result.sourceRevision ?? null,
      randomStream: 'chacha12-v1',
    },
    model: {
      simulationModel: plan.assumptions.simulationModel,
      returnGeneration: historicalBootstrapFor(plan)
        ? 'historical-circular-block-bootstrap-with-replacement'
        : 'parametric-fitted-distribution',
      returnBasis: 'real annual total returns',
      annualPortfolioFeeRate: 0.001,
      marketData: {
        id: `damodaran-sp500-10yr-treasury-bls-cpi-${DATA_FIRST_YEAR}-${DATA_LAST_YEAR}`,
        firstYear: DATA_FIRST_YEAR,
        lastYear: DATA_LAST_YEAR,
        historicalBlockYears: historicalBootstrapFor(plan) ? MONTE_CARLO_BLOCK_SIZE : null,
        statistics: {
          stockRealArithmeticMean: US_STOCK_REAL_RETURNS.mean,
          stockRealVolatility: US_STOCK_REAL_RETURNS.volatility,
          bondRealArithmeticMean: US_BOND_REAL_RETURNS.mean,
          bondRealVolatility: US_BOND_REAL_RETURNS.volatility,
          stockBondCorrelation: STOCK_BOND_CORRELATION,
          inflationArithmeticMean: US_INFLATION.mean,
        },
      },
      taxLawDollarYear: TAX_LAW_YEAR,
      healthcarePremiumPolicyYear: HEALTHCARE_PREMIUM_RULES_YEAR,
      planSchemaVersion: PLAN_SCHEMA_VERSION,
      treatments: {
        cashFlowTiming: 'annual-returns-before-cash-flows',
        assetAllocation: 'fixed-weights-annual-rebalance-no-tax-or-cost',
        taxableInvestmentIncome: 'withdrawal-gain-ratio-only-no-annual-tax-drag',
        estateTaxes: 'not-modeled',
        taxLaw: 'fixed-current-rules-projected-through-horizon',
        healthcarePremiumPolicy: 'fixed-current-rules-projected-through-horizon',
        mortality: 'fixed-life-expectancy-horizon',
        employment: 'deterministic-through-retirement-age',
        socialSecurity: 'scheduled-benefit-no-solvency-adjustment',
        longTermCareTiming: plan.profile.longTermCare.enabled
          ? 'sampled-contiguous-ending-at-horizon'
          : 'disabled',
      },
    },
    run: {
      paths: MAIN_PATHS,
      rootSeed: baseSeed(plan),
    },
    semantics: {
      conditionalNature:
        'All results are hypothetical and conditional on the exported inputs and model assumptions. They are not guarantees or calibrated real-world probabilities.',
      successProbability:
        'Share of simulated paths that fully fund every modeled working and retirement year.',
      riskOfRuin:
        'One minus successProbability. It is the share of simulated paths with at least one underfunded year.',
      terminalWealth:
        'Gross portfolio value at the plan life-expectancy age, in the stated real-dollar basis.',
      percentileRanks:
        'pN is the value at or below which N percent of simulated outcomes fall. For example, 25 percent of outcomes exceed p75.',
      yearlyPercentiles:
        'Each pN field is the cross-path percentile at that age; it is not necessarily one continuous path.',
      representativeCashFlows:
        'Yearly projection cash flows come from the median-terminal-wealth path while portfolioValue is the cross-path median for that age.',
      afterTaxTerminalWealth:
        'Value from the same path as medianTerminalWealth after applying terminalTaxRate to Traditional and HSA balances only.',
      outcomeBuckets:
        'Mean cash flows for paths in the stated terminal-wealth percentile cohort.',
    },
    input: toSimulationPlan(plan),
    output,
  });
}

function baseSeed(plan: RetirementPlan): number {
  return plan.assumptions.randomSeed;
}

function historicalBootstrapFor(plan: RetirementPlan): boolean {
  return plan.assumptions.simulationModel !== 'parametric';
}

function ssScenarios(plan: RetirementPlan, seed: number): { claimAge: number; scenario: Scenario }[] {
  // Disabled benefits make every path identical. A manual household benefit
  // is authoritative only at its selected claim age; without spouse/statement
  // detail, inventing an adjusted benefit per age would be misleading.
  const ages = plan.socialSecurity.enabled && !plan.socialSecurity.manualOverride
    ? leverRange('socialSecurityClaimAge', plan).sweepValues
    : [plan.socialSecurity.claimAge];
  return ages.map((claimAge) => ({
    claimAge,
    scenario: {
      id: `ss-${claimAge}`,
      plan: {
        ...plan,
        socialSecurity: { ...plan.socialSecurity, claimAge },
      },
      paths: SWEEP_PATHS,
      seed,
    },
  }));
}

function spendingScenarios(plan: RetirementPlan, seed: number): { annualSpending: number; scenario: Scenario }[] {
  return leverRange('spending', plan).sweepValues.map((annualSpending) => ({
    annualSpending,
    scenario: {
      id: `spending-${annualSpending}`,
      plan: {
        ...plan,
        profile: { ...plan.profile, currentSpending: annualSpending },
      },
      paths: SWEEP_PATHS,
      seed,
    },
  }));
}

function retirementAgeScenarios(plan: RetirementPlan, seed: number): { retirementAge: number; scenario: Scenario }[] {
  return leverRange('retirementAge', plan).sweepValues.map((retirementAge) => ({
    retirementAge,
    scenario: {
      id: `retirementAge-${retirementAge}`,
      plan: {
        ...plan,
        profile: { ...plan.profile, retirementAge },
      },
      paths: SWEEP_PATHS,
      seed,
    },
  }));
}

function rothConversionScenarios(
  plan: RetirementPlan,
  seed: number,
): { step: number; scenario: Scenario }[] {
  return leverRange('rothConversion', plan).sweepValues.map((step) => ({
    step,
    scenario: {
      id: `rothConversion-${step}`,
      plan: {
        ...plan,
        assumptions: {
          ...plan.assumptions,
          rothConversion: CONVERSION_STEPS[step].policy,
        },
      },
      paths: SWEEP_PATHS,
      seed,
    },
  }));
}

async function runOnServer(
  scenarios: Scenario[],
  plan: RetirementPlan,
  signal?: AbortSignal,
): Promise<Map<string, SimulationSummary>> {
  const body = {
    responseMode: 'summary',
    simulations: scenarios.map((s) => ({
      id: s.id,
      plan: toSimulationPlan(s.plan),
      config: {
        paths: s.paths,
        seed: s.seed,
        useHistoricalBootstrap: historicalBootstrapFor(plan),
        blockSize: MONTE_CARLO_BLOCK_SIZE,
      },
    })),
  };

  const response = await fetch('/api/simulation/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Batch simulation failed: ${response.status}`);
  }

  const data: { results: BatchSimulationResponse[] } = await response.json();
  const map = new Map<string, SimulationSummary>();
  for (const r of data.results) {
    const successProbability = r.successProbability ?? r.result?.successProbability;
    if (successProbability == null) {
      throw new Error(`Batch simulation omitted success probability for '${r.id}'`);
    }
    map.set(r.id, { successProbability, source: 'server' });
  }
  return map;
}

async function runOnClient(
  scenarios: Scenario[],
  signal?: AbortSignal,
): Promise<Map<string, SimulationSummary>> {
  const paths = scenarios[0]?.paths ?? 0;
  const seed = scenarios[0]?.seed ?? 0;
  if (scenarios.some((scenario) => scenario.paths !== paths || scenario.seed !== seed)) {
    throw new Error('Sensitivity scenarios must share one path count and root seed');
  }
  const summaries = await runMonteCarloSummaries(
    scenarios.map((scenario) => ({ id: scenario.id, plan: toSimulationPlan(scenario.plan) })),
    {
      paths,
      seed,
      useHistoricalBootstrap: historicalBootstrapFor(scenarios[0].plan),
      blockSize: MONTE_CARLO_BLOCK_SIZE,
    },
    signal,
  );
  const map = new Map<string, SimulationSummary>();
  for (const result of summaries) {
    map.set(result.id, { successProbability: result.successProbability, source: 'client' });
  }
  return map;
}

/**
 * Run scenarios through the requested adapter, falling back to local Wasm when
 * the native service is unavailable.
 */
async function runScenarios(
  scenarios: Scenario[],
  plan: RetirementPlan,
  useServerSide: boolean,
  signal?: AbortSignal,
): Promise<Map<string, SimulationSummary>> {
  if (useServerSide) {
    try {
      return await runOnServer(scenarios, plan, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Native simulation failed, falling back to local Wasm:', error);
    }
  }
  return runOnClient(scenarios, signal);
}

class SimulationServiceImpl implements SimulationService {
  async runMainSimulation(
    plan: RetirementPlan,
    useServerSide = true,
    signal?: AbortSignal,
  ): Promise<SimulationResult> {
    const seed = baseSeed(plan);

    if (useServerSide) {
      try {
        const response = await fetch('/api/simulation/monte-carlo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            plan: toSimulationPlan(plan),
            config: {
              paths: MAIN_PATHS,
              seed,
              useHistoricalBootstrap: historicalBootstrapFor(plan),
              blockSize: MONTE_CARLO_BLOCK_SIZE,
            },
          }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Server-side simulation failed: ${response.status}`);
        }
        const result = simulationResultSchema.parse(await response.json());
        // An engine deployed behind this build answers without cohorts. Reject
        // it so the fallback below produces a complete result, rather than
        // rendering a cash flow chart with no cohort to average.
        if (!result.outcomeBuckets?.length) {
          throw new Error('Server-side simulation omitted outcome cohorts');
        }
        return { ...result, source: 'server' };
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn('Native simulation failed, falling back to local Wasm:', error);
      }
    }

    const result = await runMonteCarloSimulation(
      toSimulationPlan(plan),
      {
        paths: MAIN_PATHS,
        seed,
        useHistoricalBootstrap: historicalBootstrapFor(plan),
        blockSize: MONTE_CARLO_BLOCK_SIZE,
      },
      signal,
    );
    return { ...result, source: 'client' };
  }

  async runSocialSecurityAnalysis(
    plan: RetirementPlan,
    useServerSide = true,
    signal?: AbortSignal,
  ): Promise<SSAnalysisResult[]> {
    const seed = baseSeed(plan);
    const entries = ssScenarios(plan, seed);
    const results = await runScenarios(entries.map((e) => e.scenario), plan, useServerSide, signal);
    return entries.map(({ claimAge, scenario }) => {
      const result = results.get(scenario.id);
      if (!result) throw new Error(`Missing result for SS age ${claimAge}`);
      return { claimAge, result };
    });
  }

  async runSpendingAnalysis(
    plan: RetirementPlan,
    useServerSide = true,
    signal?: AbortSignal,
  ): Promise<SpendingAnalysisResult[]> {
    const seed = baseSeed(plan);
    const entries = spendingScenarios(plan, seed);
    const results = await runScenarios(entries.map((e) => e.scenario), plan, useServerSide, signal);
    return entries.map(({ annualSpending, scenario }) => {
      const result = results.get(scenario.id);
      if (!result) throw new Error(`Missing result for spending level ${annualSpending}`);
      return { annualSpending, result };
    });
  }

  async runRetirementAgeAnalysis(
    plan: RetirementPlan,
    useServerSide = true,
    signal?: AbortSignal,
  ): Promise<RetirementAgeAnalysisResult[]> {
    const seed = baseSeed(plan);
    const entries = retirementAgeScenarios(plan, seed);
    const results = await runScenarios(entries.map((e) => e.scenario), plan, useServerSide, signal);
    return entries.map(({ retirementAge, scenario }) => {
      const result = results.get(scenario.id);
      if (!result) throw new Error(`Missing result for retirement age ${retirementAge}`);
      return { retirementAge, result };
    });
  }

  async runRothConversionAnalysis(
    plan: RetirementPlan,
    useServerSide = true,
    signal?: AbortSignal,
  ): Promise<RothConversionAnalysisResult[]> {
    const seed = baseSeed(plan);
    const entries = rothConversionScenarios(plan, seed);
    const results = await runScenarios(entries.map((e) => e.scenario), plan, useServerSide, signal);
    return entries.map(({ step, scenario }) => {
      const result = results.get(scenario.id);
      if (!result) throw new Error(`Missing result for conversion step ${step}`);
      return { step, result };
    });
  }

  /** Run every sensitivity curve in one bounded server batch. */
  async runSensitivityAnalyses(
    plan: RetirementPlan,
    useServerSide = true,
    signal?: AbortSignal,
  ): Promise<SensitivityAnalysisResults> {
    const seed = baseSeed(plan);
    const socialSecurityEntries = ssScenarios(plan, seed);
    const spendingEntries = spendingScenarios(plan, seed);
    const retirementAgeEntries = retirementAgeScenarios(plan, seed);
    const rothConversionEntries = rothConversionScenarios(plan, seed);
    const allScenarios = [
      ...socialSecurityEntries.map((entry) => entry.scenario),
      ...spendingEntries.map((entry) => entry.scenario),
      ...retirementAgeEntries.map((entry) => entry.scenario),
      ...rothConversionEntries.map((entry) => entry.scenario),
    ];
    const results = await runScenarios(allScenarios, plan, useServerSide, signal);

    return {
      socialSecurity: socialSecurityEntries.map(({ claimAge, scenario }) => {
        const result = results.get(scenario.id);
        if (!result) throw new Error(`Missing result for SS age ${claimAge}`);
        return { claimAge, result };
      }),
      spending: spendingEntries.map(({ annualSpending, scenario }) => {
        const result = results.get(scenario.id);
        if (!result) throw new Error(`Missing result for spending level ${annualSpending}`);
        return { annualSpending, result };
      }),
      retirementAge: retirementAgeEntries.map(({ retirementAge, scenario }) => {
        const result = results.get(scenario.id);
        if (!result) throw new Error(`Missing result for retirement age ${retirementAge}`);
        return { retirementAge, result };
      }),
      rothConversion: rothConversionEntries.map(({ step, scenario }) => {
        const result = results.get(scenario.id);
        if (!result) throw new Error(`Missing result for conversion step ${step}`);
        return { step, result };
      }),
    };
  }
}

let simulationService: SimulationService | null = null;

export function getSimulationService(): SimulationService {
  if (!simulationService) {
    simulationService = new SimulationServiceImpl();
  }
  return simulationService;
}
