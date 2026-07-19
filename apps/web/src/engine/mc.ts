import * as Comlink from 'comlink';
import type { RetirementPlan, SimulationResult } from '@/domain/types';
import type { WorkerAPI } from '@/workers/mc.worker';

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

/**
 * Initialize Web Worker for Monte Carlo simulation.
 * Creates worker instance with Comlink proxy.
 */
async function initializeWorker(): Promise<Comlink.Remote<WorkerAPI>> {
  if (workerInstance) {
    return workerInstance;
  }

  const rawWorker = new Worker(
    new URL('@/workers/mc.worker.ts', import.meta.url),
    { type: 'module' }
  );

  workerInstance = Comlink.wrap<WorkerAPI>(rawWorker);
  return workerInstance;
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
  plan: RetirementPlan,
  config: MCConfig = { paths: 5000, seed: 42 }
): Promise<SimulationResult> {
  try {
    const worker = await initializeWorker();
    const result = await worker.runSimulation(plan, config);
    return result;
  } catch (error) {
    console.error('Monte Carlo simulation failed:', error);
    throw new Error('Simulation failed. Please check your inputs and try again.');
  }
}

/**
 * Validate simulation inputs before running Monte Carlo.
 * Ensures all required data is present and reasonable.
 * 
 * @param plan - Retirement plan to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateSimulationInputs(plan: RetirementPlan): string[] {
  const errors: string[] = [];
  
  if (plan.accounts.length === 0) {
    errors.push('At least one account is required');
  }
  
  for (const account of plan.accounts) {
    const weightSum = Object.values(account.assetWeights).reduce((sum, w) => sum + w, 0);
    if (Math.abs(weightSum - 1) > 0.001) {
      errors.push(`Account "${account.name}" asset weights must sum to 1.0`);
    }
  }
  
  if (plan.profile.retirementAge <= plan.profile.age) {
    errors.push('Retirement age must be greater than current age');
  }
  
  if (plan.profile.desiredSpending <= 0) {
    errors.push('Desired spending must be positive');
  }
  
  return errors;
}