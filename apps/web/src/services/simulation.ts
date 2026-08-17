/**
 * Simulation orchestration.
 *
 * Scenario construction (which claim ages / spending levels / retirement ages
 * to sweep, which seeds to use) lives HERE and only here, so the server (Rust)
 * and client (Web Worker) engines always compute the same scenarios. The
 * engines differ only in where the math runs.
 */

import { runMonteCarloSimulation, runMonteCarloSummaries } from '@/engine/mc';
import { retirementSpendingOf } from '@/domain/age';
import { MONTE_CARLO_DEFAULTS } from '@/data/market-history';
import { MIN_RETIREMENT_AGE, PLAN_SCHEMA_VERSION } from '@/domain/constants';
import type {
  RetirementPlan,
  SimulationPlan,
  SimulationResult,
  SimulationSummary,
  SSAnalysisResult,
  SpendingAnalysisResult,
  RetirementAgeAnalysisResult
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
}

const MAIN_PATHS = 5000;
// The headline and every sensitivity scenario share one root seed, so path i
// draws the same market returns at every grid point. That makes sampling error
// common-mode along a curve — the shape stays readable at path counts far
// below what an absolute probability would need. The main simulation, not
// these curves, is what reports the headline number.
const SWEEP_PATHS = 300;

const STANDARD_SPENDING_LEVELS = [60_000, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000];
const STANDARD_RETIREMENT_AGES = [45, 50, 55, 60, 65, 70];

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

/** Build the minimal transient plan shared by both compute engines. */
function toSimulationPlan(plan: RetirementPlan): SimulationPlan {
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

function baseSeed(plan: RetirementPlan): number {
  return plan.assumptions.randomSeed;
}

function historicalBootstrapFor(plan: RetirementPlan): boolean {
  return plan.assumptions.simulationModel !== 'parametric';
}

function ssScenarios(plan: RetirementPlan, seed: number): { claimAge: number; scenario: Scenario }[] {
  // Disabled benefits make every path identical. A manual household benefit
  // is authoritative only at its selected claim age; without spouse/statement
  // detail, inventing nine differently adjusted benefits would be misleading.
  const ages = plan.socialSecurity.enabled && !plan.socialSecurity.manualOverride
    ? [...new Set([62, 64, 66, 68, 70, plan.socialSecurity.claimAge])].sort((a, b) => a - b)
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
  // Keep comparisons stable as the plan changes. Add an in-range plan value so
  // its marker is simulated exactly without changing the displayed domain.
  const current = plan.profile.currentSpending;
  const levels = [...STANDARD_SPENDING_LEVELS];
  if (current >= STANDARD_SPENDING_LEVELS[0]
    && current <= STANDARD_SPENDING_LEVELS[STANDARD_SPENDING_LEVELS.length - 1]) {
    levels.push(current);
  }
  const uniqueLevels = [...new Set(levels)].sort((a, b) => a - b);
  return uniqueLevels.map((annualSpending) => ({
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
  // Keep the comparison range stable. Values beyond the modeled lifetime are
  // omitted because they would violate the simulation contract.
  const hi = Math.min(100, plan.profile.lifeExpectancy - 1);
  const ages = STANDARD_RETIREMENT_AGES.filter((age) => age >= MIN_RETIREMENT_AGE && age <= hi);
  if (plan.profile.retirementAge >= MIN_RETIREMENT_AGE
    && plan.profile.retirementAge <= 70
    && plan.profile.retirementAge <= hi) {
    ages.push(plan.profile.retirementAge);
  }
  const uniqueAges = [...new Set(ages)].sort((a, b) => a - b);
  return uniqueAges.map((retirementAge) => ({
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
        blockSize: MONTE_CARLO_DEFAULTS.block_size,
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
    { paths, seed },
    signal,
  );
  const map = new Map<string, SimulationSummary>();
  for (const result of summaries) {
    map.set(result.id, { successProbability: result.successProbability, source: 'client' });
  }
  return map;
}

/**
 * Run a scenario set on the requested engine, falling back to the client
 * engine when the server is unavailable.
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
      console.warn('Server-side simulation failed, falling back to client engine:', error);
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
              blockSize: MONTE_CARLO_DEFAULTS.block_size,
            },
          }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Server-side simulation failed: ${response.status}`);
        }
        const result: SimulationResult = await response.json();
        return { ...result, source: 'server' };
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn('Server-side simulation failed, falling back to client engine:', error);
      }
    }

    const result = await runMonteCarloSimulation(
      toSimulationPlan(plan),
      { paths: MAIN_PATHS, seed },
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

  /** Run all three sensitivity curves in one bounded server batch. */
  async runSensitivityAnalyses(
    plan: RetirementPlan,
    useServerSide = true,
    signal?: AbortSignal,
  ): Promise<SensitivityAnalysisResults> {
    const seed = baseSeed(plan);
    const socialSecurityEntries = ssScenarios(plan, seed);
    const spendingEntries = spendingScenarios(plan, seed);
    const retirementAgeEntries = retirementAgeScenarios(plan, seed);
    const allScenarios = [
      ...socialSecurityEntries.map((entry) => entry.scenario),
      ...spendingEntries.map((entry) => entry.scenario),
      ...retirementAgeEntries.map((entry) => entry.scenario),
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
