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
const SWEEP_PATHS = 1000; // reduced per-scenario paths for interactive sweeps

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
    ? Array.from({ length: 9 }, (_, i) => 62 + i)
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
  // 11 levels centered on current spending, step ≈ 10% rounded to nearest $5k.
  const base = plan.profile.currentSpending;
  const step = Math.max(5000, Math.round(base * 0.1 / 5000) * 5000);
  const levels = [...new Set(
    Array.from({ length: 11 }, (_, i) => (
      Math.max(0, Math.min(1_000_000_000, base + step * (i - 5)))
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

  // ±5 years around a future retirement date, bounded by the current age and
  // the modeled lifetime so every generated scenario remains valid.
  const min = Math.max(ageOn(plan.profile.birthDate, plan.profile.asOfDate), center - 5, MIN_RETIREMENT_AGE);
  const max = Math.min(100, plan.profile.lifeExpectancy - 1, center + 5);
  const ages: number[] = [];
  for (let a = min; a <= max; a++) ages.push(a);
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
