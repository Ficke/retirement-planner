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
  runMainSimulation(plan: RetirementPlan, useServerSide?: boolean): Promise<SimulationResult>;

  // Analysis simulations
  runSocialSecurityAnalysis(plan: RetirementPlan, useServerSide?: boolean): Promise<SSAnalysisResult[]>;
  runSpendingAnalysis(plan: RetirementPlan, useServerSide?: boolean): Promise<SpendingAnalysisResult[]>;
  runRetirementAgeAnalysis(plan: RetirementPlan, useServerSide?: boolean): Promise<RetirementAgeAnalysisResult[]>;
}

/**
 * Server-side simulation using Next.js API proxy to Rust service
 */
async function runServerSideSimulation(plan: RetirementPlan): Promise<SimulationResult> {
  const response = await fetch('/api/simulation/monte-carlo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan,
      config: {
        paths: 5000,
        seed: 42,
        realDollars: plan.assumptions.realDollarDisplay,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server-side simulation failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Pure implementation - orchestrates computation with server-side vs client-side routing.
 */
class SimulationServiceImpl implements SimulationService {
  async runMainSimulation(plan: RetirementPlan, useServerSide = true): Promise<SimulationResult> {
    if (useServerSide) {
      try {
        console.log('🦀 Using server-side Rust simulation');
        return await runServerSideSimulation(plan);
      } catch (error) {
        console.warn('Server-side simulation failed, falling back to client-side:', error);
        // Fall through to client-side
      }
    }

    console.log('🌐 Using client-side Web Worker simulation');
    return runMonteCarloSimulation(plan, {
      paths: 5000,
      seed: 42,
      realDollars: plan.assumptions.realDollarDisplay,
    });
  }

  async runSocialSecurityAnalysis(plan: RetirementPlan, useServerSide = true): Promise<SSAnalysisResult[]> {
    // Note: For now, analysis functions still use client-side calculation
    // TODO: Implement server-side analysis endpoints in future iterations
    return engineRunSSAnalysis(plan);
  }

  async runSpendingAnalysis(plan: RetirementPlan, useServerSide = true): Promise<SpendingAnalysisResult[]> {
    // Note: For now, analysis functions still use client-side calculation
    // TODO: Implement server-side analysis endpoints in future iterations
    return engineRunSpendingAnalysis(plan);
  }

  async runRetirementAgeAnalysis(plan: RetirementPlan, useServerSide = true): Promise<RetirementAgeAnalysisResult[]> {
    // Note: For now, analysis functions still use client-side calculation
    // TODO: Implement server-side analysis endpoints in future iterations
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