import * as Comlink from 'comlink';
import type { RetirementPlan, SimulationResult, YearlyProjection, PathProjection, IncomeSourcesRow } from '@/domain/types';
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
  plan: RetirementPlan,
  config: WorkerMCConfig
): Promise<SimulationResult> {
  const { paths, seed } = config;

  const terminalWealths: number[] = [];
  const allProjections: PathProjection[][] = [];
  let successCount = 0;

  for (let pathIndex = 0; pathIndex < paths; pathIndex++) {
    const result = projectScenario(plan, { paths: 1, seed: seed + pathIndex });
    terminalWealths.push(result.terminalWealth);
    allProjections.push(result.projections);
    // Success requires funding every retirement year in full AND ending above
    // zero — same definition as the Rust engine (PathResult.success).
    if (result.success) successCount++;
  }

  terminalWealths.sort((a, b) => a - b);

  const idx = (q: number) => Math.min(Math.floor(paths * q), paths - 1);
  const p5Index = idx(0.05);
  const p10Index = idx(0.1);
  const p15Index = idx(0.15);
  const p25Index = idx(0.25);
  const p50Index = idx(0.5);
  const p75Index = idx(0.75);
  const p90Index = idx(0.9);

  // Aggregate yearly projections across paths: median of each field per year,
  // portfolio-value percentiles for the fan chart.
  const numYears = allProjections[0]?.length ?? 0;
  if (numYears === 0) {
    throw new Error('Simulation produced no projections');
  }

  const yearlyProjections: YearlyProjection[] = [];
  for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
    const rows = allProjections.map((p) => p[yearIndex]);

    const sorted = (sel: (r: PathProjection) => number) =>
      rows.map(sel).sort((a, b) => a - b);

    const portfolioValues = sorted((r) => r.portfolioValue);
    const median = (sel: (r: PathProjection) => number) => sorted(sel)[p50Index];

    const base = rows[0];
    yearlyProjections.push({
      year: base.year,
      age: base.age,
      isRetired: base.isRetired,

      portfolioValue: portfolioValues[p50Index],
      income: median((r) => r.income),
      spending: median((r) => r.spending),
      taxes: median((r) => r.taxes),
      savings: median((r) => r.savings),
      socialSecurityBenefit: median((r) => r.socialSecurityBenefit),
      withdrawalTaxable: median((r) => r.withdrawalTaxable),
      withdrawalTraditional: median((r) => r.withdrawalTraditional),
      withdrawalRoth: median((r) => r.withdrawalRoth),
      withdrawalHSA: median((r) => r.withdrawalHSA),
      rmdAmount: median((r) => r.rmdAmount),
      depositTaxable: median((r) => r.depositTaxable),
      depositTraditional: median((r) => r.depositTraditional),
      depositRoth: median((r) => r.depositRoth),
      depositHSA: median((r) => r.depositHSA),
      insufficientFunds: base.insufficientFunds,

      p5: portfolioValues[p5Index],
      p10: portfolioValues[p10Index],
      p15: portfolioValues[p15Index],
      p25: portfolioValues[p25Index],
      p50: portfolioValues[p50Index],
      p75: portfolioValues[p75Index],
      p90: portfolioValues[p90Index],
    });
  }

  // Smoothed income-sources path: mean of coherent paths in the [p25, p75]
  // terminal-wealth band. Keeps the typical withdrawal strategy intact while
  // smoothing the per-path noise that makes a single median path look jagged.
  const p25Wealth = terminalWealths[p25Index];
  const p75Wealth = terminalWealths[p75Index];
  const bandPaths = allProjections.filter((projections) => {
    const last = projections[projections.length - 1];
    return last && last.portfolioValue >= p25Wealth && last.portfolioValue <= p75Wealth;
  });
  const incomeSourcesPath: IncomeSourcesRow[] = [];
  if (bandPaths.length > 0) {
    for (let y = 0; y < numYears; y++) {
      const rows = bandPaths.map((p) => p[y]).filter(Boolean);
      if (rows.length === 0) continue;
      const mean = (sel: (r: PathProjection) => number) =>
        rows.reduce((s, r) => s + sel(r), 0) / rows.length;
      incomeSourcesPath.push({
        age: rows[0].age,
        isRetired: rows[0].isRetired,
        socialSecurityBenefit: mean((r) => r.socialSecurityBenefit),
        withdrawalTaxable: mean((r) => r.withdrawalTaxable),
        withdrawalTraditional: mean((r) => r.withdrawalTraditional),
        withdrawalRoth: mean((r) => r.withdrawalRoth),
        withdrawalHSA: mean((r) => r.withdrawalHSA),
      });
    }
  }

  const successProbability = successCount / paths;

  return {
    successProbability,
    medianTerminalWealth: terminalWealths[p50Index],
    percentile5TerminalWealth: terminalWealths[p5Index],
    percentile10TerminalWealth: terminalWealths[p10Index],
    percentile90TerminalWealth: terminalWealths[p90Index],
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
