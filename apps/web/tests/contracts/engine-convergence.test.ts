/**
 * Verifies that the Rust and TypeScript engines converge on the same aggregate
 * metrics. Both are seeded from the same root, but seedrandom and Rust's StdRng
 * turn that seed into different draws, so this is a convergence check over many
 * paths rather than the exact per-year agreement `engine-parity` asserts.
 */

import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/engine/projection';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
import type { SimulationPlan, SimulationResult, PathResult } from '@/domain/types';

const serviceUrl = process.env.RUST_SERVICE_URL;
if (!serviceUrl) {
  throw new Error('RUST_SERVICE_URL is required for engine contract tests');
}

/** The Monte Carlo loop the worker runs, inlined so the test needs no worker. */
async function runClientSideSimulation(
  plan: SimulationPlan,
  config: { paths: number; seed: number }
): Promise<SimulationResult> {
  const pathResults: PathResult[] = [];
  for (let i = 0; i < config.paths; i++) {
    const pathSeed = config.seed + i;
    const result = projectScenario(plan, {
      paths: 1,
      seed: pathSeed,
    });
    pathResults.push(result);
  }

  const terminalWealths = pathResults.map(r => r.terminalWealth).sort((a, b) => a - b);
  const successCount = pathResults.filter(r => r.success).length;

  const p10Index = Math.floor(config.paths * 0.10);
  const p50Index = Math.floor(config.paths * 0.50);
  const p90Index = Math.floor(config.paths * 0.90);

  return {
    successProbability: successCount / config.paths,
    medianAfterTaxTerminalWealth: 0,
  medianTerminalWealth: terminalWealths[p50Index],
    percentile10TerminalWealth: terminalWealths[p10Index],
    percentile90TerminalWealth: terminalWealths[p90Index],
    percentile5TerminalWealth: terminalWealths[Math.floor(config.paths * 0.05)],
    riskOfRuin: 1 - successCount / config.paths,
    yearlyProjections: [],
    outcomeBuckets: [],
  };
}

describe('TypeScript/Rust engine convergence', () => {
  const testPlan: SimulationPlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    profile: {
      birthDate: '1989-01-01',
      state: 'CA',
      filingStatus: 'Single',
      retirementAge: 65,
      currentSalary: 100_000,
      salaryGrowthRate: 0.03,
      currentSpending: 50_000,
      workingSpendingGrowthRate: 0,
      retirementSpending: 50_000,
      retirementSpendingGrowthRate: 0.02,
      lifeExpectancy: 90,
      retirementHealthcare: {
        preMedicarePremium: 12_000,
        medicarePremium: 6_000,
        outOfPocket: 3_000,
        realGrowthRate: 0.02,
      },
      asOfDate: '2024-01-01',
    },
    accounts: [
      { type: 'Traditional', balance: 150_000, assetWeights: { stocks: 0.8, bonds: 0.2 } },
      { type: 'Roth', balance: 50_000, assetWeights: { stocks: 0.9, bonds: 0.1 } },
      { type: 'Taxable', balance: 50_000, assetWeights: { stocks: 0.7, bonds: 0.3 } },
    ],
    socialSecurity: {
      enabled: true,
      claimAge: 67,
      manualOverride: false,
    },
    assumptions: {
      simulationModel: 'historical',
      randomSeed: 42,
      taxableGainRatio: 0.5,
      hsaEligible: false,
      useBackdoorRoth: false,
      rothConversion: { enabled: false, ceiling: 'bracket24' as const },
      terminalTaxRate: 0.30,
    },
  };

  it('agrees on success probability and median wealth over 1,000 paths', async () => {
    const config = { paths: 1_000, seed: 42 };

    const clientStart = performance.now();
    const clientResult = await runClientSideSimulation(testPlan, config);
    const clientTime = performance.now() - clientStart;

    const serverStart = performance.now();
    const serverResponse = await fetch(new URL('/api/simulate', serviceUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan: testPlan,
        config,
      }),
    });
    if (!serverResponse.ok) {
      throw new Error(`Rust service returned ${serverResponse.status}: ${await serverResponse.text()}`);
    }
    const serverResult: SimulationResult = await serverResponse.json();
    const serverTime = performance.now() - serverStart;

    console.log(
      `convergence: success ${(clientResult.successProbability * 100).toFixed(1)}% vs `
      + `${(serverResult.successProbability * 100).toFixed(1)}%, median `
      + `$${(clientResult.medianTerminalWealth / 1e6).toFixed(2)}M vs `
      + `$${(serverResult.medianTerminalWealth / 1e6).toFixed(2)}M, `
      + `${clientTime.toFixed(0)}ms vs ${serverTime.toFixed(0)}ms`,
    );

    // Both engines are deterministic, so these bounds are stable; they are set
    // well inside the observed gap so an aggregation bug has nowhere to hide.
    // The tails run wider than the median because 1,000 paths sample them thinly.
    const near = (a: number, b: number) => Math.abs(a - b) / Math.abs(a);

    expect(
      Math.abs(clientResult.successProbability - serverResult.successProbability),
    ).toBeLessThan(0.02);
    expect(near(clientResult.medianTerminalWealth, serverResult.medianTerminalWealth))
      .toBeLessThan(0.05);
    expect(near(clientResult.percentile10TerminalWealth, serverResult.percentile10TerminalWealth))
      .toBeLessThan(0.15);
    expect(near(clientResult.percentile90TerminalWealth, serverResult.percentile90TerminalWealth))
      .toBeLessThan(0.20);
  }, 60_000);
});
