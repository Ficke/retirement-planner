/**
 * Simulation orchestration.
 *
 * Scenario construction (which claim ages / spending levels / retirement ages
 * to sweep, which seeds to use) lives HERE and only here, so the server (Rust)
 * and client (Web Worker) engines always compute the same scenarios. The
 * engines differ only in where the math runs.
 */

import { runMonteCarloSimulation } from '@/engine/mc';
import { MONTE_CARLO_DEFAULTS } from '@/data/market-history';
import { MIN_RETIREMENT_AGE } from '@/domain/constants';
import type {
  RetirementPlan,
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

// --- Scenario builders (shared by both engines) ---

function ssScenarios(plan: RetirementPlan, seed: number): { claimAge: number; scenario: Scenario }[] {
  const ages = Array.from({ length: 9 }, (_, i) => 62 + i);
  return ages.map((claimAge) => ({
    claimAge,
    scenario: {
      id: `ss-${claimAge}`,
      plan: {
        ...plan,
        socialSecurity: { ...plan.socialSecurity, enabled: true, claimAge },
      },
      paths: SWEEP_PATHS,
      // Common random numbers isolate the effect of claim age from MC noise.
      seed: seed + 1000,
    },
  }));
}

function spendingScenarios(plan: RetirementPlan, seed: number): { annualSpending: number; scenario: Scenario }[] {
  // 11 levels centered on desiredSpending, step ≈ 10% rounded to nearest $5k
  const base = plan.profile.desiredSpending;
  const step = Math.max(5000, Math.round(base * 0.1 / 5000) * 5000);
  const levels = Array.from({ length: 11 }, (_, i) => base + step * (i - 5)).filter((s) => s > 0);
  return levels.map((annualSpending) => ({
    annualSpending,
    scenario: {
      id: `spending-${annualSpending}`,
      plan: {
        ...plan,
        profile: { ...plan.profile, desiredSpending: annualSpending },
      },
      paths: SWEEP_PATHS,
      seed: seed + 2000,
    },
  }));
}

function retirementAgeScenarios(plan: RetirementPlan, seed: number): { retirementAge: number; scenario: Scenario }[] {
  // ±5 years around the planned retirement age, clamped to a sane window.
  const center = plan.profile.retirementAge;
  const min = Math.max(plan.profile.age + 1, Math.min(center - 5, 70), MIN_RETIREMENT_AGE);
  const max = Math.min(75, Math.max(center + 5, min));
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

// --- Engine backends ---

async function runOnServer(
  scenarios: Scenario[],
  plan: RetirementPlan,
  signal?: AbortSignal,
): Promise<Map<string, SimulationResult>> {
  const body = {
    simulations: scenarios.map((s) => ({
      id: s.id,
      plan: s.plan,
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
      s.plan,
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
            plan,
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

    const result = await runMonteCarloSimulation(plan, { paths: MAIN_PATHS, seed }, signal);
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

  /** Run all Overview sensitivity curves in one bounded server batch. */
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
