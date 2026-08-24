import * as Comlink from 'comlink';
import type { SimulationPlan, SimulationResult } from '@/domain/types';
import type { WorkerAPI, WorkerSweepScenario } from '@/workers/mc.worker';
import { simulationPlanSchema } from '@/domain/schemas';
import rustSourceRevision from '@/wasm/source.sha256?raw';

/** Browser Worker orchestration for the Rust WebAssembly engine. */

export interface MCConfig {
  paths: number;
  seed: number;
  useHistoricalBootstrap: boolean;
  blockSize: number;
}

let workerInstance: Comlink.Remote<WorkerAPI> | null = null;
let rawWorkerInstance: Worker | null = null;
let sweepWorkerInstances: Array<{
  raw: Worker;
  remote: Comlink.Remote<WorkerAPI>;
}> = [];

async function initializeWorker(): Promise<Comlink.Remote<WorkerAPI>> {
  if (workerInstance) {
    return workerInstance;
  }

  rawWorkerInstance = new Worker(
    new URL('@/workers/mc.worker.ts', import.meta.url),
    { type: 'module' }
  );

  workerInstance = Comlink.wrap<WorkerAPI>(rawWorkerInstance);
  return workerInstance;
}

function cancelMainWorker(): void {
  rawWorkerInstance?.terminate();
  rawWorkerInstance = null;
  workerInstance = null;
}

function cancelSweepWorkers(): void {
  for (const worker of sweepWorkerInstances) worker.raw.terminate();
  sweepWorkerInstances = [];
}

function abortError(): DOMException {
  return new DOMException('Simulation aborted', 'AbortError');
}

async function waitForWorker<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  cancel: () => void,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    cancel();
    throw abortError();
  }

  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancel();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Terminate CPU work immediately; the next run creates a fresh worker. */
export function cancelMonteCarloSimulation(): void {
  cancelMainWorker();
  cancelSweepWorkers();
}

export function sweepPathShards(
  paths: number,
  hardwareConcurrency: number,
): Array<{ startPath: number; endPath: number }> {
  if (!Number.isSafeInteger(paths) || paths < 1) {
    throw new RangeError('Path count must be a positive safe integer');
  }
  const availableWorkers = Number.isFinite(hardwareConcurrency)
    ? Math.max(Math.floor(hardwareConcurrency) - 1, 1)
    : 1;
  const workerCount = Math.min(
    Math.min(availableWorkers, 8),
    paths,
  );
  const basePathsPerWorker = Math.floor(paths / workerCount);
  const workersWithExtraPath = paths % workerCount;
  let startPath = 0;
  return Array.from({ length: workerCount }, (_, workerIndex) => {
    const shardSize = basePathsPerWorker + (workerIndex < workersWithExtraPath ? 1 : 0);
    const shard = { startPath, endPath: startPath + shardSize };
    startPath = shard.endPath;
    return shard;
  });
}

function initializeSweepWorkers(count: number): Array<Comlink.Remote<WorkerAPI>> {
  while (sweepWorkerInstances.length < count) {
    const raw = new Worker(new URL('@/workers/mc.worker.ts', import.meta.url), { type: 'module' });
    sweepWorkerInstances.push({ raw, remote: Comlink.wrap<WorkerAPI>(raw) });
  }
  return sweepWorkerInstances.slice(0, count).map((worker) => worker.remote);
}

export async function runMonteCarloSummaries(
  scenarios: WorkerSweepScenario[],
  config: MCConfig,
  signal?: AbortSignal,
): Promise<Array<{ id: string; successProbability: number }>> {
  if (signal?.aborted) throw abortError();
  if (scenarios.length === 0) return [];

  const hardwareConcurrency = typeof navigator === 'undefined'
    ? 2
    : navigator.hardwareConcurrency || 2;
  const shards = sweepPathShards(config.paths, hardwareConcurrency);
  const workers = initializeSweepWorkers(shards.length);
  let shardCounts: number[][];
  try {
    shardCounts = await waitForWorker(
      Promise.all(workers.map((worker, workerIndex) => {
        const { startPath, endPath } = shards[workerIndex];
        return worker.runSweepShard(scenarios, config, startPath, endPath);
      })),
      signal,
      cancelSweepWorkers,
    );
  } catch (error) {
    cancelSweepWorkers();
    throw error;
  }
  if (signal?.aborted) throw abortError();

  const counts = new Array<number>(scenarios.length).fill(0);
  for (const shard of shardCounts) {
    for (let index = 0; index < shard.length; index++) counts[index] += shard[index];
  }
  return scenarios.map((scenario, index) => ({
    id: scenario.id,
    successProbability: counts[index] / config.paths,
  }));
}

export async function runMonteCarloSimulation(
  plan: SimulationPlan,
  config: MCConfig,
  signal?: AbortSignal,
): Promise<SimulationResult> {
  if (signal?.aborted) throw abortError();
  try {
    const worker = await initializeWorker();
    const [result, engineVersion] = await waitForWorker(
      Promise.all([
        worker.runSimulation(plan, config),
        worker.engineVersion(),
      ]),
      signal,
      cancelMainWorker,
    );
    if (signal?.aborted) throw abortError();
    return {
      ...result,
      engineVersion,
      sourceRevision: rustSourceRevision.trim(),
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    cancelMainWorker();
    console.error('Monte Carlo simulation failed:', error);
    throw new Error('Simulation failed. Please check your inputs and try again.');
  }
}

export function validateSimulationInputs(plan: SimulationPlan): string[] {
  const validation = simulationPlanSchema.safeParse(plan);
  return validation.success
    ? []
    : validation.error.issues.map((issue) => issue.message);
}
