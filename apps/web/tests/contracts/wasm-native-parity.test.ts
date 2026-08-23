import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
import { simulationResultSchema } from '@/domain/schemas';
import type { SimulationModel, SimulationPlan, SimulationResult } from '@/domain/types';
import {
  initSync as initializeWasm,
  run_simulation as runWasmSimulation,
  run_sweep_shard as runWasmSweepShard,
  wasm_abi_version as wasmAbiVersion,
} from '@/wasm/retirement_simulation';

interface SimulationRequest {
  plan: SimulationPlan;
  config: {
    paths: number;
    seed: number;
    useHistoricalBootstrap: boolean;
    blockSize: number;
  };
}

const serviceUrl = process.env.RUST_SERVICE_URL;

function requiredServiceUrl(): string {
  if (!serviceUrl) {
    throw new Error('RUST_SERVICE_URL is required for native contract tests');
  }
  return serviceUrl;
}

const EXPECTED_WASM_ABI_VERSION = 1;
const NUMERIC_PARITY_POLICY = {
  absoluteTolerance: 1e-7,
  relativeTolerance: 1e-11,
};

function planFor(simulationModel: SimulationModel): SimulationPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    profile: {
      birthDate: '1987-04-12',
      state: 'CA',
      filingStatus: 'MarriedFilingJointly',
      retirementAge: 65,
      currentSalary: 180_000,
      salaryGrowthRate: 0.025,
      currentSpending: 85_000,
      workingSpendingGrowthRate: 0.005,
      retirementSpending: 95_000,
      retirementSpendingGrowthRate: 0.015,
      lifeExpectancy: 92,
      retirementHealthcare: {
        preMedicarePremium: 18_000,
        medicarePremium: 9_000,
        outOfPocket: 6_000,
        realGrowthRate: 0.02,
      },
      longTermCare: { enabled: true, costMultiplier: 1.2 },
      asOfDate: '2026-08-23',
    },
    accounts: [
      {
        type: 'Taxable',
        balance: 175_000,
        assetWeights: { stocks: 0.7, bonds: 0.3 },
      },
      {
        type: 'Traditional',
        balance: 425_000,
        assetWeights: { stocks: 0.75, bonds: 0.25 },
      },
      {
        type: 'Roth',
        balance: 110_000,
        assetWeights: { stocks: 0.85, bonds: 0.15 },
      },
      {
        type: 'HSA',
        balance: 35_000,
        assetWeights: { stocks: 0.8, bonds: 0.2 },
      },
    ],
    socialSecurity: {
      enabled: true,
      claimAge: 67,
      manualOverride: false,
    },
    assumptions: {
      simulationModel,
      randomSeed: 2_026,
      taxableGainRatio: 0.55,
      hsaEligible: true,
      useBackdoorRoth: true,
      rothConversion: { enabled: true, ceiling: 'bracket24' },
      terminalTaxRate: 0.3,
    },
  };
}

const fixtures: Array<{ name: string; request: SimulationRequest }> = [
  {
    name: 'historical block bootstrap',
    request: {
      plan: planFor('historical'),
      config: {
        paths: 64,
        seed: 12_345,
        useHistoricalBootstrap: true,
        blockSize: 5,
      },
    },
  },
  {
    name: 'parametric returns',
    request: {
      plan: planFor('parametric'),
      config: {
        paths: 64,
        seed: 54_321,
        useHistoricalBootstrap: false,
        blockSize: 5,
      },
    },
  },
];

beforeAll(async () => {
  const wasmPath = new URL('../../src/wasm/retirement_simulation_bg.wasm', import.meta.url);
  const wasmBytes = Uint8Array.from(await readFile(wasmPath));
  initializeWasm({ module: wasmBytes });
});

async function runNativeSimulation(request: SimulationRequest): Promise<SimulationResult> {
  const response = await fetch(new URL('/api/simulate', requiredServiceUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Rust service returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<SimulationResult>;
}

function expectNumericParity(wasmValue: number, nativeValue: number, path: string): void {
  expect(Number.isFinite(wasmValue), `${path} Wasm value is finite`).toBe(true);
  expect(Number.isFinite(nativeValue), `${path} native value is finite`).toBe(true);

  const difference = Math.abs(wasmValue - nativeValue);
  const scale = Math.max(Math.abs(wasmValue), Math.abs(nativeValue));
  const tolerance = Math.max(
    NUMERIC_PARITY_POLICY.absoluteTolerance,
    NUMERIC_PARITY_POLICY.relativeTolerance * scale,
  );
  expect(
    difference,
    `${path}: Wasm ${wasmValue} and native ${nativeValue} differ by ${difference}, `
      + `exceeding tolerance ${tolerance}`,
  ).toBeLessThanOrEqual(tolerance);
}

function expectResponseParity(wasmValue: unknown, nativeValue: unknown, path = '$'): void {
  if (typeof wasmValue === 'number' && typeof nativeValue === 'number') {
    expectNumericParity(wasmValue, nativeValue, path);
    return;
  }

  if (Array.isArray(wasmValue) && Array.isArray(nativeValue)) {
    expect(wasmValue.length, `${path} array length`).toBe(nativeValue.length);
    for (let index = 0; index < wasmValue.length; index += 1) {
      expectResponseParity(wasmValue[index], nativeValue[index], `${path}[${index}]`);
    }
    return;
  }

  if (
    typeof wasmValue === 'object'
    && wasmValue !== null
    && typeof nativeValue === 'object'
    && nativeValue !== null
  ) {
    const wasmRecord = wasmValue as Record<string, unknown>;
    const nativeRecord = nativeValue as Record<string, unknown>;
    const wasmKeys = Object.keys(wasmRecord).sort();
    const nativeKeys = Object.keys(nativeRecord).sort();
    expect(wasmKeys, `${path} object keys`).toEqual(nativeKeys);
    for (const key of wasmKeys) {
      expectResponseParity(wasmRecord[key], nativeRecord[key], `${path}.${key}`);
    }
    return;
  }

  expect(wasmValue, path).toEqual(nativeValue);
}

describe('Wasm/native Rust simulation contract', () => {
  it('exposes the ABI version expected by the client worker', () => {
    expect(wasmAbiVersion()).toBe(EXPECTED_WASM_ABI_VERSION);
  });

  it('serializes flattened yearly projections as plain JavaScript objects', () => {
    const result = runWasmSimulation({
      ...fixtures[0].request,
      config: { ...fixtures[0].request.config, paths: 1 },
    }) as SimulationResult;

    expect(() => simulationResultSchema.parse(result)).not.toThrow();
    expect(result.yearlyProjections[0]).toMatchObject({
      age: expect.any(Number),
      portfolioValue: expect.any(Number),
      p50: expect.any(Number),
    });
    expect(Object.keys(result.yearlyProjections[0]).length).toBeGreaterThan(20);
  });

  it.each(fixtures)('matches the native service for $name', async ({ request }) => {
    const wasmResult = runWasmSimulation(request) as SimulationResult;
    const nativeResult = await runNativeSimulation(request);

    expectResponseParity(wasmResult, nativeResult);
  }, 30_000);

  it('preserves absolute path identity across Wasm sweep shards', () => {
    const simulations = fixtures.map(({ name, request }) => ({
      id: name,
      ...request,
    }));
    const ranges = [[0, 31], [31, 64]] as const;
    const successCounts = new Map(simulations.map(({ id }) => [id, 0]));

    for (const [startPath, endPath] of ranges) {
      const shard = runWasmSweepShard({
        simulations,
        startPath,
        endPath,
      }) as Array<{ id: string; successCount: number }>;
      for (const { id, successCount } of shard) {
        successCounts.set(id, (successCounts.get(id) ?? 0) + successCount);
      }
    }

    for (const simulation of simulations) {
      const full = runWasmSimulation({
        plan: simulation.plan,
        config: simulation.config,
      }) as SimulationResult;
      expect(successCounts.get(simulation.id)).toBe(
        full.successProbability * simulation.config.paths,
      );
    }
  });

  it('rejects an invalid request at the Wasm boundary', () => {
    const invalidRequest: SimulationRequest = {
      ...fixtures[0].request,
      config: { ...fixtures[0].request.config, paths: 0 },
    };

    expect(() => runWasmSimulation(invalidRequest))
      .toThrow('paths must be between 1 and 5000');
  });

  it('rejects the same invalid request at the native HTTP boundary', async () => {
    const invalidRequest: SimulationRequest = {
      ...fixtures[0].request,
      config: { ...fixtures[0].request.config, paths: 0 },
    };
    const response = await fetch(new URL('/api/simulate', requiredServiceUrl()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidRequest),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'paths must be between 1 and 5000',
    });
  });
});
