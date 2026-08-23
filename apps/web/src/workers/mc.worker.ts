import * as Comlink from 'comlink';
import type { SimulationPlan, SimulationResult } from '@/domain/types';
import { simulationResultSchema } from '@/domain/schemas';
import initWasm, {
  engine_version as rustEngineVersion,
  run_simulation as runRustSimulation,
  run_sweep_shard as runRustSweepShard,
  wasm_abi_version as rustWasmAbiVersion,
} from '@/wasm/retirement_simulation';

export interface WorkerMCConfig {
  paths: number;
  seed: number;
  useHistoricalBootstrap: boolean;
  blockSize: number;
}

export interface WorkerSweepScenario {
  id: string;
  plan: SimulationPlan;
}

const EXPECTED_WASM_ABI_VERSION = 1;
let initialization: Promise<void> | null = null;

function initializeWasm(): Promise<void> {
  if (!initialization) {
    initialization = initWasm()
      .then(() => {
        const actualVersion = rustWasmAbiVersion();
        if (actualVersion !== EXPECTED_WASM_ABI_VERSION) {
          throw new Error(
            `Simulation Wasm ABI ${actualVersion} does not match worker ABI ${EXPECTED_WASM_ABI_VERSION}`,
          );
        }
      })
      .catch((error: unknown) => {
        initialization = null;
        throw error;
      });
  }
  return initialization;
}

async function runSimulation(
  plan: SimulationPlan,
  config: WorkerMCConfig,
): Promise<SimulationResult> {
  await initializeWasm();
  return simulationResultSchema.parse(runRustSimulation({ plan, config }));
}

async function runSweepShard(
  scenarios: WorkerSweepScenario[],
  config: WorkerMCConfig,
  startPath: number,
  endPath: number,
): Promise<number[]> {
  await initializeWasm();
  const results = runRustSweepShard({
    simulations: scenarios.map(({ id, plan }) => ({ id, plan, config })),
    startPath,
    endPath,
  }) as Array<{ id: string; successCount: number }>;
  const counts = new Map(results.map(({ id, successCount }) => [id, successCount]));
  return scenarios.map(({ id }) => {
    const count = counts.get(id);
    if (count == null) throw new Error(`Rust sweep omitted scenario '${id}'`);
    return count;
  });
}

async function engineVersion(): Promise<string> {
  await initializeWasm();
  return rustEngineVersion();
}

const workerAPI = {
  runSimulation,
  runSweepShard,
  engineVersion,
};

Comlink.expose(workerAPI);

export type WorkerAPI = typeof workerAPI;
