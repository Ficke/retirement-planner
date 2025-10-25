/**
 * Pure simulation service - handles computation orchestration only.
 * No state management - that's handled by usePlan store.
 * Simple, testable, and maintainable.
 */

import { runMonteCarloSimulation } from '@/engine/mc';
import {
  runSocialSecurityAnalysis as engineRunSSAnalysis,
  runSpendingAnalysis as engineRunSpendingAnalysis,
  runRetirementAgeAnalysis as engineRunRetirementAgeAnalysis
} from '@/engine/analysis';
import type {
  RetirementPlan,
  SimulationResult,
  SSAnalysisResult,
  SpendingAnalysisResult,
  RetirementAgeAnalysisResult
} from '@/domain/types';

export interface SimulationService {
  // Main simulation
  runMainSimulation(plan: RetirementPlan): Promise<SimulationResult>;

  // Analysis simulations
  runSocialSecurityAnalysis(plan: RetirementPlan): Promise<SSAnalysisResult[]>;
  runSpendingAnalysis(plan: RetirementPlan): Promise<SpendingAnalysisResult[]>;
  runRetirementAgeAnalysis(plan: RetirementPlan): Promise<RetirementAgeAnalysisResult[]>;
}

/**
 * Pure implementation - just orchestrates computation, no state.
 */
class SimulationServiceImpl implements SimulationService {
  async runMainSimulation(plan: RetirementPlan): Promise<SimulationResult> {
    return runMonteCarloSimulation(plan, {
      paths: 5000,
      seed: 42,
      realDollars: plan.assumptions.realDollarDisplay,
    });
  }

  async runSocialSecurityAnalysis(plan: RetirementPlan): Promise<SSAnalysisResult[]> {
    return engineRunSSAnalysis(plan);
  }

  async runSpendingAnalysis(plan: RetirementPlan): Promise<SpendingAnalysisResult[]> {
    return engineRunSpendingAnalysis(plan);
  }

  async runRetirementAgeAnalysis(plan: RetirementPlan): Promise<RetirementAgeAnalysisResult[]> {
    return engineRunRetirementAgeAnalysis(plan);
  }
}

// Singleton instance - simple and stateless
let simulationService: SimulationService | null = null;

export function getSimulationService(): SimulationService {
  if (!simulationService) {
    simulationService = new SimulationServiceImpl();
  }
  return simulationService;
}