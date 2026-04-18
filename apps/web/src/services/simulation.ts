/**
 * Pure simulation service - handles computation orchestration only.
 * No state management - that's handled by usePlan store.
 * Simple, testable, and maintainable.
 */

import { runMonteCarloSimulation } from '@/engine/mc';
import { MONTE_CARLO_DEFAULTS } from '@/data/market-history';
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

interface BatchSimulationRequest {
  id: string;
  plan: RetirementPlan;
  config: {
    paths: number;
    seed: number;
    useHistoricalBootstrap: boolean;
    blockSize: number;
  };
}

interface BatchSimulationResponse {
  id: string;
  result: SimulationResult;
}

interface BatchResponse {
  results: BatchSimulationResponse[];
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
        useHistoricalBootstrap: MONTE_CARLO_DEFAULTS.use_historical_bootstrap,
        blockSize: MONTE_CARLO_DEFAULTS.block_size,
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
 * Batch server-side simulation using Next.js API proxy to Rust service
 */
async function runBatchSimulations(simulations: BatchSimulationRequest[]): Promise<BatchResponse> {
  const response = await fetch('/api/simulation/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ simulations }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Batch simulation failed: ${response.status}`);
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
        const result = await runServerSideSimulation(plan);
        return { ...result, source: 'server' };
      } catch (error) {
        console.warn('Server-side simulation failed, falling back to client-side:', error);
        // Fall through to client-side
      }
    }

    console.log('🌐 Using client-side Web Worker simulation');
    const result = await runMonteCarloSimulation(plan, {
      paths: 5000,
      seed: 42,
    });
    return { ...result, source: 'client' };
  }

  async runSocialSecurityAnalysis(plan: RetirementPlan, useServerSide = true): Promise<SSAnalysisResult[]> {
    if (useServerSide) {
      try {
        console.log('🦀 Using server-side Rust batch simulation for SS analysis');
        // Run batch simulations for each SS claim age (62-70)
        const ages = Array.from({ length: 9 }, (_, i) => 62 + i);
        const simulations: BatchSimulationRequest[] = ages.map((age) => ({
          id: `ss-${age}`,
          plan: {
            ...plan,
            socialSecurity: {
              ...plan.socialSecurity,
              enabled: true,
              claimAge: age,
            },
          },
          config: {
            paths: 1000, // Reduced from 5000 for faster analysis
            seed: 1000 + age, // Unique seed per age
            useHistoricalBootstrap: MONTE_CARLO_DEFAULTS.use_historical_bootstrap,
            blockSize: MONTE_CARLO_DEFAULTS.block_size,
          },
        }));

        const batchResponse = await runBatchSimulations(simulations);

        // Parse results back into analysis format
        return ages.map((age) => {
          const responseForAge = batchResponse.results.find((r) => r.id === `ss-${age}`);
          if (!responseForAge) {
            throw new Error(`Missing result for SS age ${age}`);
          }
          return { claimAge: age, result: { ...responseForAge.result, source: 'server' as const } };
        });
      } catch (error) {
        console.warn('Server-side SS analysis failed, falling back to client-side:', error);
        // Fall through to client-side
      }
    }

    console.log('🌐 Using client-side SS analysis');
    return engineRunSSAnalysis(plan);
  }

  async runSpendingAnalysis(plan: RetirementPlan, useServerSide = true): Promise<SpendingAnalysisResult[]> {
    if (useServerSide) {
      try {
        console.log('🦀 Using server-side Rust batch simulation for spending analysis');
        // Test spending levels from $50k to $100k in $5k increments
        const spendingLevels = Array.from({ length: 11 }, (_, i) => 50000 + i * 5000);

        const simulations: BatchSimulationRequest[] = spendingLevels.map((annualSpending) => ({
          id: `spending-${annualSpending}`,
          plan: {
            ...plan,
            profile: { ...plan.profile, desiredSpending: annualSpending },
          },
          config: {
            paths: 1000, // Reduced from 5000 for faster analysis
            seed: 2000 + annualSpending, // Unique seed per spending level
            useHistoricalBootstrap: MONTE_CARLO_DEFAULTS.use_historical_bootstrap,
            blockSize: MONTE_CARLO_DEFAULTS.block_size,
          },
        }));

        const batchResponse = await runBatchSimulations(simulations);

        // Parse results back into analysis format
        return spendingLevels.map((annualSpending) => {
          const responseForSpending = batchResponse.results.find((r) => r.id === `spending-${annualSpending}`);
          if (!responseForSpending) {
            throw new Error(`Missing result for spending level ${annualSpending}`);
          }
          return { annualSpending, result: { ...responseForSpending.result, source: 'server' as const } };
        });
      } catch (error) {
        console.warn('Server-side spending analysis failed, falling back to client-side:', error);
        // Fall through to client-side
      }
    }

    console.log('🌐 Using client-side spending analysis');
    return engineRunSpendingAnalysis(plan);
  }

  async runRetirementAgeAnalysis(plan: RetirementPlan, useServerSide = true): Promise<RetirementAgeAnalysisResult[]> {
    if (useServerSide) {
      try {
        console.log('🦀 Using server-side Rust batch simulation for retirement age analysis');
        // Test retirement ages from 55 to 65
        const ages = Array.from({ length: 11 }, (_, i) => 55 + i);

        const simulations: BatchSimulationRequest[] = ages.map((retirementAge) => ({
          id: `retirementAge-${retirementAge}`,
          plan: {
            ...plan,
            profile: { ...plan.profile, retirementAge },
          },
          config: {
            paths: 1000, // Reduced from 5000 for faster analysis
            seed: 3000 + retirementAge, // Unique seed per age
            useHistoricalBootstrap: MONTE_CARLO_DEFAULTS.use_historical_bootstrap,
            blockSize: MONTE_CARLO_DEFAULTS.block_size,
          },
        }));

        const batchResponse = await runBatchSimulations(simulations);

        // Parse results back into analysis format
        return ages.map((retirementAge) => {
          const responseForAge = batchResponse.results.find((r) => r.id === `retirementAge-${retirementAge}`);
          if (!responseForAge) {
            throw new Error(`Missing result for retirement age ${retirementAge}`);
          }
          return { retirementAge, result: { ...responseForAge.result, source: 'server' as const } };
        });
      } catch (error) {
        console.warn('Server-side retirement age analysis failed, falling back to client-side:', error);
        // Fall through to client-side
      }
    }

    console.log('🌐 Using client-side retirement age analysis');
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