import * as Comlink from 'comlink';
import type {
  OutcomeBucket,
  OutcomeCashFlowRow,
  PathProjection,
  SimulationPlan,
  SimulationResult,
  YearlyProjection,
} from '@/domain/types';
import { countSweepSuccesses, projectScenario } from '@/engine/projection';

/**
 * Monte Carlo Web Worker — the client-side simulation engine.
 * Runs simulation paths off the main thread and aggregates them into the
 * same SimulationResult shape the Rust service produces.
 */

export interface WorkerMCConfig {
  paths: number;
  seed: number;
}

export interface WorkerSweepScenario {
  id: string;
  plan: SimulationPlan;
}

const OUTCOME_CENTERS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
const CASH_FLOW_KEYS = [
  'income',
  'spending',
  'taxes',
  'savings',
  'socialSecurityBenefit',
  'withdrawalTaxable',
  'withdrawalTraditional',
  'withdrawalRoth',
  'withdrawalHSA',
  'healthcareCost',
] as const;
type CashFlowKey = typeof CASH_FLOW_KEYS[number];

function runSweepShard(
  scenarios: WorkerSweepScenario[],
  seed: number,
  startPath: number,
  endPath: number,
): number[] {
  return countSweepSuccesses(scenarios, seed, startPath, endPath);
}

async function runSimulation(
  plan: SimulationPlan,
  config: WorkerMCConfig
): Promise<SimulationResult> {
  const { paths, seed } = config;

  const terminalOutcomes: Array<{ wealth: number; pathIndex: number }> = [];
  let portfolioByPathAndYear: Float64Array | null = null;
  let cashFlowByPathAndYear: Record<CashFlowKey, Float64Array> | null = null;
  let timeline: Array<Pick<PathProjection, 'age' | 'isRetired'>> = [];
  const successByPath = new Uint8Array(paths);
  let numYears = 0;
  let successCount = 0;

  for (let pathIndex = 0; pathIndex < paths; pathIndex++) {
    const result = projectScenario(plan, { paths: 1, seed: seed + pathIndex });
    if (pathIndex === 0) {
      numYears = result.projections.length;
      if (numYears === 0) throw new Error('Simulation produced no projections');
      portfolioByPathAndYear = new Float64Array(paths * numYears);
      cashFlowByPathAndYear = Object.fromEntries(
        CASH_FLOW_KEYS.map((key) => [key, new Float64Array(paths * numYears)]),
      ) as Record<CashFlowKey, Float64Array>;
      timeline = result.projections.map(({ age, isRetired }) => ({ age, isRetired }));
    } else if (result.projections.length !== numYears) {
      throw new Error('Simulation paths produced inconsistent projection lengths');
    }
    for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
      const offset = pathIndex * numYears + yearIndex;
      const projection = result.projections[yearIndex];
      portfolioByPathAndYear![offset] = projection.portfolioValue;
      for (const key of CASH_FLOW_KEYS) {
        cashFlowByPathAndYear![key][offset] = projection[key];
      }
    }
    terminalOutcomes.push({ wealth: result.terminalWealth, pathIndex });
    if (result.success) {
      successByPath[pathIndex] = 1;
      successCount++;
    }
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

  const outcomeBuckets: OutcomeBucket[] = OUTCOME_CENTERS.map((centerPercentile) => {
    const lowerPercentile = centerPercentile - 5;
    const upperPercentile = centerPercentile + 5;
    const start = Math.min(Math.floor(paths * lowerPercentile / 100), paths - 1);
    const end = Math.min(paths, Math.max(start + 1, Math.floor(paths * upperPercentile / 100)));
    const cohort = terminalOutcomes.slice(start, end);
    const projections: OutcomeCashFlowRow[] = timeline.map((period, yearIndex) => {
      const sums = Object.fromEntries(CASH_FLOW_KEYS.map((key) => [key, 0])) as Record<CashFlowKey, number>;
      for (const { pathIndex } of cohort) {
        const offset = pathIndex * numYears + yearIndex;
        for (const key of CASH_FLOW_KEYS) sums[key] += cashFlowByPathAndYear![key][offset];
      }
      const count = cohort.length;
      return {
        ...period,
        income: sums.income / count,
        spending: sums.spending / count,
        taxes: sums.taxes / count,
        savings: sums.savings / count,
        socialSecurityBenefit: sums.socialSecurityBenefit / count,
        withdrawalTaxable: sums.withdrawalTaxable / count,
        withdrawalTraditional: sums.withdrawalTraditional / count,
        withdrawalRoth: sums.withdrawalRoth / count,
        withdrawalHSA: sums.withdrawalHSA / count,
        healthcareCost: sums.healthcareCost / count,
      };
    });
    const bucketSuccesses = cohort.reduce(
      (total, { pathIndex }) => total + successByPath[pathIndex],
      0,
    );
    return {
      centerPercentile,
      lowerPercentile,
      upperPercentile,
      successProbability: bucketSuccesses / cohort.length,
      projections,
    };
  });

  const successProbability = successCount / paths;

  return {
    successProbability,
    medianTerminalWealth: terminalOutcomes[p50Index].wealth,
    percentile5TerminalWealth: terminalOutcomes[p5Index].wealth,
    percentile10TerminalWealth: terminalOutcomes[p10Index].wealth,
    percentile90TerminalWealth: terminalOutcomes[p90Index].wealth,
    yearlyProjections,
    outcomeBuckets,
    riskOfRuin: 1 - successProbability,
  };
}

const workerAPI = {
  runSimulation,
  runSweepShard,
};

Comlink.expose(workerAPI);

export type WorkerAPI = typeof workerAPI;
