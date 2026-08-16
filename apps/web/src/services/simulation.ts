/**
 * Simulation orchestration.
 *
 * Scenario construction (which claim ages / spending levels / retirement ages
 * to sweep, which seeds to use) lives HERE and only here, so the server (Rust)
 * and client (Web Worker) engines always compute the same scenarios. The
 * engines differ only in where the math runs.
 */

import { runMonteCarloSimulation } from '@/engine/mc';
import { ageOn, retirementSpendingOf } from '@/domain/age';
import { MONTE_CARLO_DEFAULTS } from '@/data/market-history';
import { MIN_RETIREMENT_AGE, PLAN_SCHEMA_VERSION } from '@/domain/constants';
import type {
  RetirementPlan,
  SimulationPlan,
  SimulationResult,
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
// Every scenario in a sweep shares one base seed, so path i draws the same
// market returns at every grid point. That makes the sampling error
// common-mode along a curve — the shape stays readable at path counts far
// below what an absolute probability would need. The main simulation, not
// these curves, is what reports the headline number.
const SWEEP_PATHS = 300;

// 60–120% of first-year retirement spending. Asymmetric on purpose: the curve
// bends on the downside, and spending far above plan is not a choice anyone is
// weighing.
const SPENDING_PERCENTS = [60, 70, 80, 90, 100, 110, 120];

interface Scenario {
  id: string;
  plan: RetirementPlan;
  paths: number;
  seed: number;
}

interface BatchSimulationResponse {
  id: string;
  result: SimulationResult;
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

/**
 * Base seed for a run. A fixed seed (Settings → Randomness) gives reproducible
 * results; otherwise each run draws a fresh sample.
 */
function baseSeed(plan: RetirementPlan): number {
  return plan.assumptions.randomSeed ?? Math.floor(Math.random() * 2 ** 31);
}

function historicalBootstrapFor(plan: RetirementPlan): boolean {
  return plan.assumptions.simulationModel !== 'parametric';
}

function ssScenarios(plan: RetirementPlan, seed: number): { claimAge: number; scenario: Scenario }[] {
  // Disabled benefits make every path identical. A manual household benefit
  // is authoritative only at its selected claim age; without spouse/statement
  // detail, inventing nine differently adjusted benefits would be misleading.
  const ages = plan.socialSecurity.enabled && !plan.socialSecurity.manualOverride
    ? [62, 64, 66, 68, 70]
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
      // Common random numbers isolate the effect of claim age from MC noise.
      seed: seed + 1000,
    },
  }));
}

function spendingScenarios(plan: RetirementPlan, seed: number): { annualSpending: number; scenario: Scenario }[] {
  // The sweep moves today's spending, not the retirement target, so each level
  // shows both consequences: saving more now, and needing less later.
  // The 100% level uses the base verbatim so the marker lands on a real grid
  // point rather than an interpolated one.
  const base = plan.profile.currentSpending;
  const levels = [...new Set(
    SPENDING_PERCENTS.map((percent) => (
      percent === 100 ? base : Math.max(0, Math.round(base * percent / 100_000) * 1000)
    )),
  )];
  return levels.map((annualSpending) => ({
    annualSpending,
    scenario: {
      id: `spending-${annualSpending}`,
      plan: {
        ...plan,
        profile: { ...plan.profile, currentSpending: annualSpending },
      },
      paths: SWEEP_PATHS,
      seed: seed + 2000,
    },
  }));
}

function retirementAgeScenarios(plan: RetirementPlan, seed: number): { retirementAge: number; scenario: Scenario }[] {
  // For an already-retired plan, changing a historical retirement age cannot
  // affect future cash flows, so avoid spending compute on duplicate paths.
  const center = plan.profile.retirementAge;
  if (center <= ageOn(plan.profile.birthDate, plan.profile.asOfDate)) {
    return [{
      retirementAge: center,
      scenario: {
        id: `retirementAge-${center}`,
        plan,
        paths: SWEEP_PATHS,
        seed: seed + 3000,
      },
    }];
  }

  // ±4 years in 2-year steps, bounded by the current age and the modeled
  // lifetime so every generated scenario remains valid. The center is always
  // included, so the marker lands on a real grid point.
  const lo = Math.max(ageOn(plan.profile.birthDate, plan.profile.asOfDate), MIN_RETIREMENT_AGE);
  const hi = Math.min(100, plan.profile.lifeExpectancy - 1);
  const ages = [-4, -2, 0, 2, 4]
    .map((offset) => center + offset)
    .filter((age) => age >= lo && age <= hi);
  return ages.map((retirementAge) => ({
    retirementAge,
    scenario: {
      id: `retirementAge-${retirementAge}`,
      plan: {
        ...plan,
        profile: { ...plan.profile, retirementAge },
      },
      paths: SWEEP_PATHS,
      seed: seed + 3000,
    },
  }));
}

async function runOnServer(
  scenarios: Scenario[],
  plan: RetirementPlan,
  signal?: AbortSignal,
): Promise<Map<string, SimulationResult>> {
  const body = {
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
  const map = new Map<string, SimulationResult>();
  for (const r of data.results) {
    map.set(r.id, { ...r.result, source: 'server' });
  }
  return map;
}

async function runOnClient(
  scenarios: Scenario[],
  signal?: AbortSignal,
): Promise<Map<string, SimulationResult>> {
  const map = new Map<string, SimulationResult>();
  for (const s of scenarios) {
    if (signal?.aborted) throw new DOMException('Simulation aborted', 'AbortError');
    const result = await runMonteCarloSimulation(
      toSimulationPlan(s.plan),
      { paths: s.paths, seed: s.seed },
      signal,
    );
    map.set(s.id, { ...result, source: 'client' });
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
): Promise<Map<string, SimulationResult>> {
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
