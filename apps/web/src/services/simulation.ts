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
import type {
  RetirementPlan,
  SimulationResult,
  SSAnalysisResult,
  SpendingAnalysisResult,
  RetirementAgeAnalysisResult
} from '@/domain/types';

export interface SimulationService {
  runMainSimulation(plan: RetirementPlan, useServerSide?: boolean): Promise<SimulationResult>;
  runSocialSecurityAnalysis(plan: RetirementPlan, useServerSide?: boolean): Promise<SSAnalysisResult[]>;
  runSpendingAnalysis(plan: RetirementPlan, useServerSide?: boolean): Promise<SpendingAnalysisResult[]>;
  runRetirementAgeAnalysis(plan: RetirementPlan, useServerSide?: boolean): Promise<RetirementAgeAnalysisResult[]>;
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
      seed: seed + 1000 + claimAge,
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
      seed: seed + 2000 + annualSpending,
    },
  }));
}

function retirementAgeScenarios(plan: RetirementPlan, seed: number): { retirementAge: number; scenario: Scenario }[] {
  // ±5 years around the planned retirement age, clamped to a sane window.
  const center = plan.profile.retirementAge;
  const min = Math.max(plan.profile.age + 1, Math.min(center - 5, 70), 45);
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
      seed: seed + 3000 + retirementAge,
    },
  }));
}

// --- Engine backends ---

async function runOnServer(scenarios: Scenario[], plan: RetirementPlan): Promise<Map<string, SimulationResult>> {
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

async function runOnClient(scenarios: Scenario[]): Promise<Map<string, SimulationResult>> {
  const map = new Map<string, SimulationResult>();
  for (const s of scenarios) {
    const result = await runMonteCarloSimulation(s.plan, { paths: s.paths, seed: s.seed });
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
): Promise<Map<string, SimulationResult>> {
  if (useServerSide) {
    try {
      return await runOnServer(scenarios, plan);
    } catch (error) {
      console.warn('Server-side simulation failed, falling back to client engine:', error);
    }
  }
  return runOnClient(scenarios);
}

class SimulationServiceImpl implements SimulationService {
  async runMainSimulation(plan: RetirementPlan, useServerSide = true): Promise<SimulationResult> {
    const seed = baseSeed(plan);

    if (useServerSide) {
      try {
        const response = await fetch('/api/simulation/monte-carlo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        console.warn('Server-side simulation failed, falling back to client engine:', error);
      }
    }

    const result = await runMonteCarloSimulation(plan, { paths: MAIN_PATHS, seed });
    return { ...result, source: 'client' };
  }

  async runSocialSecurityAnalysis(plan: RetirementPlan, useServerSide = true): Promise<SSAnalysisResult[]> {
    const seed = baseSeed(plan);
    const entries = ssScenarios(plan, seed);
    const results = await runScenarios(entries.map((e) => e.scenario), plan, useServerSide);
    return entries.map(({ claimAge, scenario }) => {
      const result = results.get(scenario.id);
      if (!result) throw new Error(`Missing result for SS age ${claimAge}`);
      return { claimAge, result };
    });
  }

  async runSpendingAnalysis(plan: RetirementPlan, useServerSide = true): Promise<SpendingAnalysisResult[]> {
    const seed = baseSeed(plan);
    const entries = spendingScenarios(plan, seed);
    const results = await runScenarios(entries.map((e) => e.scenario), plan, useServerSide);
    return entries.map(({ annualSpending, scenario }) => {
      const result = results.get(scenario.id);
      if (!result) throw new Error(`Missing result for spending level ${annualSpending}`);
      return { annualSpending, result };
    });
  }

  async runRetirementAgeAnalysis(plan: RetirementPlan, useServerSide = true): Promise<RetirementAgeAnalysisResult[]> {
    const seed = baseSeed(plan);
    const entries = retirementAgeScenarios(plan, seed);
    const results = await runScenarios(entries.map((e) => e.scenario), plan, useServerSide);
    return entries.map(({ retirementAge, scenario }) => {
      const result = results.get(scenario.id);
      if (!result) throw new Error(`Missing result for retirement age ${retirementAge}`);
      return { retirementAge, result };
    });
  }
}

let simulationService: SimulationService | null = null;

export function getSimulationService(): SimulationService {
  if (!simulationService) {
    simulationService = new SimulationServiceImpl();
  }
  return simulationService;
}
