import { afterEach, describe, it, expect, vi } from 'vitest';
import { createTestAccount } from './test-helpers';
import {
  cancelMonteCarloSimulation,
  runMonteCarloSimulation,
  runMonteCarloSummaries,
  sweepPathShards,
  validateSimulationInputs,
} from '@/engine/mc';
import type { SimulationPlan, SimulationResult } from '@/domain/types';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';

vi.mock('comlink', () => ({
  wrap: (worker: { remote: unknown }) => worker.remote,
}));

afterEach(() => {
  cancelMonteCarloSimulation();
  vi.unstubAllGlobals();
});

const testPlan: SimulationPlan = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  profile: {
    birthDate: '1990-01-01',
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 100000,
    salaryGrowthRate: 0.03,
    currentSpending: 60000,
    workingSpendingGrowthRate: 0,
    retirementSpending: 60000,
    retirementSpendingGrowthRate: 0.02,
    lifeExpectancy: 85,
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    longTermCare: { enabled: false, costMultiplier: 1 },
    asOfDate: '2025-01-01',
  },
  accounts: [
    createTestAccount({
      id: 'test-1',
      name: 'Test Account',
      type: 'Taxable',
      balance: 100000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    }),
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

describe('Monte Carlo Simulation', () => {
  it('shards every sensitivity path exactly once and caps the pool at eight workers', () => {
    const shards = sweepPathShards(300, 32);
    expect(shards).toHaveLength(8);
    expect(shards[0].startPath).toBe(0);
    expect(shards.at(-1)?.endPath).toBe(300);
    for (let index = 1; index < shards.length; index++) {
      expect(shards[index].startPath).toBe(shards[index - 1].endPath);
    }
    expect(shards.reduce((total, shard) => total + shard.endPath - shard.startPath, 0)).toBe(300);
  });

  it.each([
    { paths: 1, hardwareConcurrency: 10, expectedWorkers: 1 },
    { paths: 3, hardwareConcurrency: 10, expectedWorkers: 3 },
    { paths: 9, hardwareConcurrency: 10, expectedWorkers: 8 },
    { paths: 10, hardwareConcurrency: 10, expectedWorkers: 8 },
  ])('balances $paths paths across non-empty contiguous shards', ({
    paths,
    hardwareConcurrency,
    expectedWorkers,
  }) => {
    const shards = sweepPathShards(paths, hardwareConcurrency);

    expect(shards).toHaveLength(expectedWorkers);
    expect(shards[0].startPath).toBe(0);
    expect(shards.at(-1)?.endPath).toBe(paths);
    expect(shards.every(({ startPath, endPath }) => endPath > startPath)).toBe(true);
    for (let index = 1; index < shards.length; index++) {
      expect(shards[index].startPath).toBe(shards[index - 1].endPath);
    }
    expect(shards.reduce((total, shard) => total + shard.endPath - shard.startPath, 0)).toBe(paths);

    const sizes = shards.map(({ startPath, endPath }) => endPath - startPath);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('balances nine paths over eight workers without emitting an empty final shard', () => {
    expect(sweepPathShards(9, 10)).toEqual([
      { startPath: 0, endPath: 2 },
      { startPath: 2, endPath: 3 },
      { startPath: 3, endPath: 4 },
      { startPath: 4, endPath: 5 },
      { startPath: 5, endPath: 6 },
      { startPath: 6, endPath: 7 },
      { startPath: 7, endPath: 8 },
      { startPath: 8, endPath: 9 },
    ]);
  });

  it('rejects invalid path counts before creating a worker pool', () => {
    expect(() => sweepPathShards(0, 8)).toThrow(RangeError);
    expect(() => sweepPathShards(1.5, 8)).toThrow(RangeError);
  });

  it('reduces integer shard counts to per-scenario probabilities', async () => {
    class LocalWorker {
      remote = {
        runSimulation: () => new Promise<never>(() => {}),
        runSweepShard: async (
          scenarios: Array<{ id: string; plan: SimulationPlan }>,
          _config: { seed: number },
          startPath: number,
          endPath: number,
        ) => scenarios.map((_, scenarioIndex) => {
          if (scenarioIndex === 0) return endPath - startPath;
          let successes = 0;
          for (let pathIndex = startPath; pathIndex < endPath; pathIndex += 1) {
            if (pathIndex % 2 === 0) successes += 1;
          }
          return successes;
        }),
      };

      terminate() {}
    }
    vi.stubGlobal('Worker', LocalWorker);
    const scenarios = [
      { id: 'base', plan: testPlan },
      {
        id: 'high-spending',
        plan: {
          ...testPlan,
          profile: { ...testPlan.profile, retirementSpending: 250_000 },
        },
      },
    ];
    const paths = 11;
    const summaries = await runMonteCarloSummaries(scenarios, {
      paths,
      seed: 42,
      useHistoricalBootstrap: true,
      blockSize: 5,
    });

    expect(summaries).toEqual([
      { id: 'base', successProbability: 1 },
      { id: 'high-spending', successProbability: 6 / 11 },
    ]);
  });

  it('terminates sensitivity workers and rejects promptly when aborted', async () => {
    const workers: Array<{ terminated: boolean; calls: number }> = [];
    class PendingWorker {
      terminated = false;
      calls = 0;
      remote = {
        runSimulation: () => new Promise<never>(() => {}),
        runSweepShard: () => {
          this.calls++;
          return new Promise<never>(() => {});
        },
      };

      constructor() {
        workers.push(this);
      }

      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', PendingWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 10 });
    const controller = new AbortController();
    const simulation = runMonteCarloSummaries(
      [{ id: 'base', plan: testPlan }],
      { paths: 300, seed: 42, useHistoricalBootstrap: true, blockSize: 5 },
      controller.signal,
    );

    expect(workers).toHaveLength(8);
    expect(workers.every((worker) => worker.calls === 1)).toBe(true);
    controller.abort();

    await expect(simulation).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers.every((worker) => worker.terminated)).toBe(true);

    const secondController = new AbortController();
    const secondSimulation = runMonteCarloSummaries(
      [{ id: 'base', plan: testPlan }],
      { paths: 300, seed: 42, useHistoricalBootstrap: true, blockSize: 5 },
      secondController.signal,
    );

    expect(workers).toHaveLength(16);
    expect(workers.slice(8).every((worker) => (
      worker.calls === 1 && !worker.terminated
    ))).toBe(true);
    secondController.abort();

    await expect(secondSimulation).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers.slice(8)).toHaveLength(8);
    expect(workers.slice(8).every((worker) => worker.terminated)).toBe(true);
  });

  it('recreates the main worker after an operation failure', async () => {
    const workers: Array<{ terminated: boolean }> = [];
    class RecoveringWorker {
      terminated = false;
      private readonly attempt = workers.length;
      remote = {
        runSimulation: () => this.attempt === 0
          ? Promise.reject(new Error('Wasm initialization failed'))
          : Promise.resolve({ successProbability: 1 } as SimulationResult),
        runSweepShard: () => Promise.resolve([]),
        engineVersion: () => Promise.resolve('test-engine'),
      };

      constructor() {
        workers.push(this);
      }

      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', RecoveringWorker);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = {
      paths: 1,
      seed: 42,
      useHistoricalBootstrap: true,
      blockSize: 5,
    };

    await expect(runMonteCarloSimulation(testPlan, config)).rejects.toThrow('Simulation failed');
    expect(workers[0].terminated).toBe(true);
    await expect(runMonteCarloSimulation(testPlan, config)).resolves.toMatchObject({
      successProbability: 1,
      engineVersion: 'test-engine',
      sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(workers).toHaveLength(2);
  });

  it('recreates sensitivity workers after an operation failure', async () => {
    const workers: Array<{ terminated: boolean }> = [];
    class RecoveringWorker {
      terminated = false;
      private readonly attempt = workers.length;
      remote = {
        runSimulation: () => Promise.resolve({} as SimulationResult),
        runSweepShard: (_scenarios: unknown, _config: unknown, start: number, end: number) => (
          this.attempt === 0
            ? Promise.reject(new Error('Wasm initialization failed'))
            : Promise.resolve([end - start])
        ),
        engineVersion: () => Promise.resolve('test-engine'),
      };

      constructor() {
        workers.push(this);
      }

      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', RecoveringWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    const config = {
      paths: 3,
      seed: 42,
      useHistoricalBootstrap: true,
      blockSize: 5,
    };

    await expect(runMonteCarloSummaries([{ id: 'base', plan: testPlan }], config))
      .rejects.toThrow('Wasm initialization failed');
    expect(workers[0].terminated).toBe(true);
    await expect(runMonteCarloSummaries([{ id: 'base', plan: testPlan }], config))
      .resolves.toEqual([{ id: 'base', successProbability: 1 }]);
    expect(workers).toHaveLength(2);
  });

  it('accepts valid simulation inputs', () => {
    const errors = validateSimulationInputs(testPlan);
    expect(errors).toEqual([]);
  });

  it('rejects plans with invalid asset weights', () => {
    const invalidPlan = {
      ...testPlan,
      accounts: [{
        ...testPlan.accounts[0],
        assetWeights: { stocks: 0.6, bonds: 0.5 },
      }],
    };
    
    const errors = validateSimulationInputs(invalidPlan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/asset weights must sum to 1.0/i);
  });

  it('accepts already-retired and Social-Security-only plans', () => {
    const retiredPlan: SimulationPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        birthDate: '1952-01-01',
        retirementAge: 65,
        lifeExpectancy: 90,
      },
      accounts: [],
    };
    expect(validateSimulationInputs(retiredPlan)).toEqual([]);
  });

});
