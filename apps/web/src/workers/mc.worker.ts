import * as Comlink from 'comlink';
import type { SimulationPlan, SimulationResult, YearlyProjection, IncomeSourcesRow } from '@/domain/types';
import { projectScenario } from '@/engine/projection';

/**
 * Monte Carlo Web Worker — the client-side simulation engine.
 * Runs simulation paths off the main thread and aggregates them into the
 * same SimulationResult shape the Rust service produces.
 */

export interface WorkerMCConfig {
  paths: number;
  seed: number;
}

async function runSimulation(
  plan: SimulationPlan,
  config: WorkerMCConfig
): Promise<SimulationResult> {
  const { paths, seed } = config;

  const terminalOutcomes: Array<{ wealth: number; pathIndex: number }> = [];
  let portfolioByPathAndYear: Float64Array | null = null;
  let numYears = 0;
  let successCount = 0;

  for (let pathIndex = 0; pathIndex < paths; pathIndex++) {
    const result = projectScenario(plan, { paths: 1, seed: seed + pathIndex });
    if (pathIndex === 0) {
      numYears = result.projections.length;
      if (numYears === 0) throw new Error('Simulation produced no projections');
      portfolioByPathAndYear = new Float64Array(paths * numYears);
    } else if (result.projections.length !== numYears) {
      throw new Error('Simulation paths produced inconsistent projection lengths');
    }
    for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
      portfolioByPathAndYear![pathIndex * numYears + yearIndex] =
        result.projections[yearIndex].portfolioValue;
    }
    terminalOutcomes.push({ wealth: result.terminalWealth, pathIndex });
    if (result.success) successCount++;
  }

  terminalOutcomes.sort((a, b) => a.wealth - b.wealth);

  const idx = (q: number) => Math.min(Math.floor(paths * q), paths - 1);
  const p5Index = idx(0.05);
  const p10Index = idx(0.1);
  const p15Index = idx(0.15);
  const p25Index = idx(0.25);
  const p50Index = idx(0.5);
  const p75Index = idx(0.75);
  const p90Index = idx(0.9);

  // Re-run the median-terminal-wealth path for a coherent cash-flow story.
  // This avoids field-wise medians whose income, tax, and withdrawal values
  // can come from different paths and fail to reconcile.
  const representativePathIndex = terminalOutcomes[p50Index].pathIndex;
  const representative = projectScenario(plan, {
    paths: 1,
    seed: seed + representativePathIndex,
  }).projections;

  const yearlyProjections: YearlyProjection[] = [];
  for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
    const portfolioValues = new Array<number>(paths);
    for (let pathIndex = 0; pathIndex < paths; pathIndex++) {
      portfolioValues[pathIndex] = portfolioByPathAndYear![pathIndex * numYears + yearIndex];
    }
    portfolioValues.sort((a, b) => a - b);
    const base = representative[yearIndex];
    yearlyProjections.push({
      ...base,
      portfolioValue: portfolioValues[p50Index],
      p5: portfolioValues[p5Index],
      p10: portfolioValues[p10Index],
      p15: portfolioValues[p15Index],
      p25: portfolioValues[p25Index],
      p50: portfolioValues[p50Index],
      p75: portfolioValues[p75Index],
      p90: portfolioValues[p90Index],
    });
  }

  const incomeSourcesPath: IncomeSourcesRow[] = representative.map((row) => ({
    age: row.age,
    isRetired: row.isRetired,
    socialSecurityBenefit: row.socialSecurityBenefit,
    withdrawalTaxable: row.withdrawalTaxable,
    withdrawalTraditional: row.withdrawalTraditional,
    withdrawalRoth: row.withdrawalRoth,
    withdrawalHSA: row.withdrawalHSA,
  }));

  const successProbability = successCount / paths;

  return {
    successProbability,
    medianTerminalWealth: terminalOutcomes[p50Index].wealth,
    percentile5TerminalWealth: terminalOutcomes[p5Index].wealth,
    percentile10TerminalWealth: terminalOutcomes[p10Index].wealth,
    percentile90TerminalWealth: terminalOutcomes[p90Index].wealth,
    yearlyProjections,
    incomeSourcesPath,
    riskOfRuin: 1 - successProbability,
  };
}

const workerAPI = {
  runSimulation,
};

Comlink.expose(workerAPI);

export type WorkerAPI = typeof workerAPI;
