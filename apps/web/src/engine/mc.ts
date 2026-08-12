import * as Comlink from 'comlink';
import type { SimulationPlan, SimulationResult } from '@/domain/types';
import type { WorkerAPI } from '@/workers/mc.worker';
import { simulationPlanSchema } from '@/domain/schemas';

/**
 * Monte Carlo simulation client wrapper.
 * Handles communication with Web Worker for heavy computation.
 * Returns aggregated results from multiple simulation paths.
 */

export interface MCConfig {
  paths: number;
  seed: number;
}

let workerInstance: Comlink.Remote<WorkerAPI> | null = null;
let rawWorkerInstance: Worker | null = null;

/**
 * Initialize Web Worker for Monte Carlo simulation.
 * Creates worker instance with Comlink proxy.
 */
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

/** Terminate CPU work immediately; the next run creates a fresh worker. */
export function cancelMonteCarloSimulation(): void {
  rawWorkerInstance?.terminate();
  rawWorkerInstance = null;
  workerInstance = null;
}

/**
 * Run Monte Carlo simulation using Web Worker.
 * Aggregates multiple projection paths into statistical summary.
 * 
 * @param plan - Complete retirement plan configuration  
 * @param config - Monte Carlo simulation parameters
 * @returns Promise resolving to simulation results
 */
export async function runMonteCarloSimulation(
  plan: SimulationPlan,
  config: MCConfig = { paths: 5000, seed: 42 },
  signal?: AbortSignal,
): Promise<SimulationResult> {
  if (signal?.aborted) throw new DOMException('Simulation aborted', 'AbortError');
  const cancel = () => cancelMonteCarloSimulation();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const worker = await initializeWorker();
    const result = await worker.runSimulation(plan, config);
    if (signal?.aborted) throw new DOMException('Simulation aborted', 'AbortError');
    return result;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Simulation aborted', 'AbortError');
    console.error('Monte Carlo simulation failed:', error);
    throw new Error('Simulation failed. Please check your inputs and try again.');
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * Validate simulation inputs before running Monte Carlo.
 * Ensures all required data is present and reasonable.
 * 
 * @param plan - Retirement plan to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateSimulationInputs(plan: SimulationPlan): string[] {
  const validation = simulationPlanSchema.safeParse(plan);
  return validation.success
    ? []
    : validation.error.issues.map((issue) => issue.message);
}
