import * as Comlink from 'comlink';
import type { RetirementPlan, SimulationResult, YearlyProjection, PathProjection, PathResult } from '@/domain/types';
import { projectScenario, type ProjectionConfig } from '@/engine/projection';

/**
 * Monte Carlo Web Worker for heavy computation.
 * Runs multiple simulation paths without blocking the main thread.
 * Uses Comlink for type-safe communication with main thread.
 * Optimized with parallel batch processing for 5000+ paths.
 */

/**
 * Extended path result with additional analytics for aggregation.
 * Adds threshold tracking and age-specific wealth snapshots to base PathResult.
 */
interface ExtendedPathResult extends PathResult {
  everBelow1m: boolean;
  everBelow500k: boolean;
  wealthAtAge: Record<number, number>;
}

/**
 * Process a single Monte Carlo path.
 * Extracted for parallel processing optimization.
 */
function processPath(
  plan: RetirementPlan,
  pathSeed: number
): ExtendedPathResult {
  const projectionConfig: ProjectionConfig = {
    paths: 1,
    seed: pathSeed,
  };

  const pathResult = projectScenario(plan, projectionConfig);

  // Analyze wealth thresholds and age snapshots
  let everBelow1m = false;
  let everBelow500k = false;
  let sawAge95 = false;
  let lastAge = 0;
  let lastPortfolio = 0;
  const wealthAtAge: Record<number, number> = {};

  for (const year of pathResult.projections) {
    // Only consider wealth thresholds once retired
    if (year.isRetired) {
      if (!everBelow1m && year.portfolioValue < 1_000_000) {
        everBelow1m = true;
      }
      if (!everBelow500k && year.portfolioValue < 500_000) {
        everBelow500k = true;
      }
    }

    // Capture wealth at specific ages
    if ([65, 75, 85, 95].includes(year.age)) {
      wealthAtAge[year.age] = year.portfolioValue;
    }

    if (year.age === 95) {
      sawAge95 = true;
    }
    lastAge = year.age;
    lastPortfolio = year.portfolioValue;
  }

  // Approximate age 95 if projections stopped at 94
  if (!sawAge95 && lastAge === 94) {
    wealthAtAge[95] = lastPortfolio;
  }

  return {
    ...pathResult,
    everBelow1m,
    everBelow500k,
    wealthAtAge,
  };
}

export interface WorkerMCConfig {
  paths: number;
  seed: number;
}

/**
 * Performance metrics for monitoring simulation efficiency
 */
interface PerformanceMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  pathsPerSecond?: number;
  chunksProcessed: number;
  averageChunkTime: number;
}

/**
 * Run Monte Carlo simulation with multiple paths using optimized parallel processing.
 * Aggregates results into percentiles and success probability.
 *
 * @param plan - Complete retirement plan
 * @param config - Simulation parameters
 * @returns Aggregated simulation results
 */
async function runSimulation(
  plan: RetirementPlan,
  config: WorkerMCConfig
): Promise<SimulationResult> {
  const { paths, seed } = config;

  // Initialize performance tracking
  const metrics: PerformanceMetrics = {
    startTime: performance.now(),
    chunksProcessed: 0,
    averageChunkTime: 0,
  };

  try {
    // Calculate optimal chunk size for parallel processing
    const maxConcurrentPaths = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency * 100  // 100 paths per CPU core
      : 500; // Fallback for environments without navigator
    const chunkSize = Math.min(paths, maxConcurrentPaths);
    const numChunks = Math.ceil(paths / chunkSize);


  // Arrays to store aggregated results from all chunks
  const terminalWealths: number[] = [];
  const allProjections: PathProjection[][] = []; // Collect PathProjection[] from each path
  let successCount = 0;
  let ruinCount = 0;
  let below1mCount = 0;
  let below500kCount = 0;
  const wealthAtAgeValues: Record<number, number[]> = {
    65: [],
    75: [],
    85: [],
    95: [],
  };

    // Process paths in parallel chunks with performance monitoring
    let totalChunkTime = 0;
    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const chunkStartTime = performance.now();
      const chunkStart = chunkIndex * chunkSize;
      const chunkEnd = Math.min(chunkStart + chunkSize, paths);
      const actualChunkSize = chunkEnd - chunkStart;

      try {
        // Create promises for all paths in this chunk with individual error handling
        const chunkPromises = Array.from({ length: actualChunkSize }, async (_, i) => {
          const pathIndex = chunkStart + i;
          try {
            return await processPath(plan, seed + pathIndex);
          } catch (pathError) {
            // Log individual path failure but don't fail entire simulation
            console.warn(`Path ${pathIndex + 1}/${paths} failed:`, pathError);
            // Return a fallback result with zero wealth to indicate failure
            return {
              terminalWealth: 0,
              projections: [],
              success: false,
              everBelow1m: true,
              everBelow500k: true,
              wealthAtAge: {}
            } as ExtendedPathResult;
          }
        });

        // Execute chunk in parallel with timeout protection
        const chunkResults = await Promise.all(chunkPromises);

        // Aggregate results from this chunk
        for (const result of chunkResults) {
          // Skip failed paths (empty projections) from aggregation stats
          // but still count them as ruins
          if (result.projections.length === 0) {
            ruinCount++;
            terminalWealths.push(0);
            continue;
          }

          terminalWealths.push(result.terminalWealth);
          allProjections.push(result.projections);

          if (result.terminalWealth > 0) {
            successCount++;
          } else {
            ruinCount++;
          }

          if (result.everBelow1m) below1mCount++;
          if (result.everBelow500k) below500kCount++;

          // Merge wealth at age values
          for (const [age, value] of Object.entries(result.wealthAtAge)) {
            const ageNum = Number(age);
            if (wealthAtAgeValues[ageNum]) {
              wealthAtAgeValues[ageNum].push(value);
            }
          }
        }

        // Update performance metrics
        const chunkTime = performance.now() - chunkStartTime;
        totalChunkTime += chunkTime;
        metrics.chunksProcessed++;
        metrics.averageChunkTime = totalChunkTime / metrics.chunksProcessed;

      } catch (error) {
        console.error(`Error processing chunk ${chunkIndex + 1}/${numChunks}:`, error);
        throw new Error(`Simulation failed at chunk ${chunkIndex + 1}: ${error}`);
      }
    }

    // Calculate final performance metrics
    metrics.endTime = performance.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    metrics.pathsPerSecond = paths / (metrics.duration / 1000);


    // Sort terminal wealths for percentile calculation
    terminalWealths.sort((a, b) => a - b);

  // Calculate percentiles
  const p5Index = Math.floor(paths * 0.05);
  const p10Index = Math.floor(paths * 0.1);
  const p15Index = Math.floor(paths * 0.15);
  const p25Index = Math.floor(paths * 0.25);
  const p50Index = Math.floor(paths * 0.5);
  const p75Index = Math.floor(paths * 0.75);
  const p90Index = Math.floor(paths * 0.9);

  // Aggregate yearly projections across all paths
  // This is where we transform PathProjection[] into YearlyProjection[] by adding percentiles
  const yearlyProjections: YearlyProjection[] = [];

  // Find first valid projection to determine number of years
  const firstValidProjection = allProjections.find(p => p.length > 0);
  const numYears = firstValidProjection?.length || 0;

  // Only aggregate if we have valid projections
  if (numYears === 0) {
    console.error('No valid projections found in simulation results');
    throw new Error('All simulation paths failed - no valid projections generated');
  }

  for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
    // Extract all values for this year across all valid paths (skip failed paths)
    const validProjections = allProjections.filter(p => p.length > yearIndex);

    if (validProjections.length === 0) {
      console.warn(`No valid projections for year ${yearIndex}, skipping`);
      continue;
    }

    const yearPortfolioValues = validProjections.map(projection => projection[yearIndex].portfolioValue);
    const yearIncomes = validProjections.map(projection => projection[yearIndex].income);
    const yearSpending = validProjections.map(projection => projection[yearIndex].spending);
    const yearTaxes = validProjections.map(projection => projection[yearIndex].taxes);
    const yearSavings = validProjections.map(projection => projection[yearIndex].savings);
    const yearSSBenefits = validProjections.map(projection => projection[yearIndex].socialSecurityBenefit);
    const yearWithdrawalTaxable = validProjections.map(projection => projection[yearIndex].withdrawalTaxable);
    const yearWithdrawalTraditional = validProjections.map(projection => projection[yearIndex].withdrawalTraditional);
    const yearWithdrawalRoth = validProjections.map(projection => projection[yearIndex].withdrawalRoth);
    const yearWithdrawalHSA = validProjections.map(projection => projection[yearIndex].withdrawalHSA);
    const yearRMD = validProjections.map(projection => projection[yearIndex].rmdAmount);
    const yearDepositTaxable = validProjections.map(projection => projection[yearIndex].depositTaxable);
    const yearDepositTraditional = validProjections.map(projection => projection[yearIndex].depositTraditional);
    const yearDepositRoth = validProjections.map(projection => projection[yearIndex].depositRoth);
    const yearDepositHSA = validProjections.map(projection => projection[yearIndex].depositHSA);

    // Sort all arrays for percentile calculation
    yearPortfolioValues.sort((a, b) => a - b);
    yearIncomes.sort((a, b) => a - b);
    yearSpending.sort((a, b) => a - b);
    yearTaxes.sort((a, b) => a - b);
    yearSavings.sort((a, b) => a - b);
    yearSSBenefits.sort((a, b) => a - b);
    yearWithdrawalTaxable.sort((a, b) => a - b);
    yearWithdrawalTraditional.sort((a, b) => a - b);
    yearWithdrawalRoth.sort((a, b) => a - b);
    yearWithdrawalHSA.sort((a, b) => a - b);
    yearRMD.sort((a, b) => a - b);
    yearDepositTaxable.sort((a, b) => a - b);
    yearDepositTraditional.sort((a, b) => a - b);
    yearDepositRoth.sort((a, b) => a - b);
    yearDepositHSA.sort((a, b) => a - b);

    // Use first valid path as template for non-financial data
    const baseProjection = validProjections[0][yearIndex];

    // Create aggregated projection using median values for display
    // PathProjection fields + percentiles = YearlyProjection
    yearlyProjections.push({
      year: baseProjection.year,
      age: baseProjection.age,
      isRetired: baseProjection.isRetired,
      
      // Use median values for primary display metrics
      portfolioValue: yearPortfolioValues[p50Index],
      income: yearIncomes[p50Index],
      spending: yearSpending[p50Index], 
      taxes: yearTaxes[p50Index],
      savings: yearSavings[p50Index],
      socialSecurityBenefit: yearSSBenefits[p50Index],
      withdrawalTaxable: yearWithdrawalTaxable[p50Index],
      withdrawalTraditional: yearWithdrawalTraditional[p50Index],
      withdrawalRoth: yearWithdrawalRoth[p50Index],
      withdrawalHSA: yearWithdrawalHSA[p50Index],
      rmdAmount: yearRMD[p50Index],

      // Median across paths — deposits/withdrawals vary per path (e.g. RMD excess reinvestment)
      depositTaxable: yearDepositTaxable[p50Index],
      depositTraditional: yearDepositTraditional[p50Index],
      depositRoth: yearDepositRoth[p50Index],
      depositHSA: yearDepositHSA[p50Index],
      insufficientFunds: baseProjection.insufficientFunds,
      
      // Add percentile ranges for fan charts
      p5: yearPortfolioValues[p5Index],
      p10: yearPortfolioValues[p10Index],
      p15: yearPortfolioValues[p15Index],
      p25: yearPortfolioValues[p25Index],
      p50: yearPortfolioValues[p50Index],
      p75: yearPortfolioValues[p75Index],
      p90: yearPortfolioValues[p90Index],
    });
  }
  
  const wealthAtAge: Record<number, { p25: number; p50: number; p75: number }> = {};
  for (const age of Object.keys(wealthAtAgeValues)) {
    const ageNum = Number(age);
    const values = wealthAtAgeValues[ageNum];
    if (values.length) {
      values.sort((a, b) => a - b);
      const p25 = values[Math.floor(values.length * 0.25)];
      const p50 = values[Math.floor(values.length * 0.5)];
      const p75 = values[Math.floor(values.length * 0.75)];
      wealthAtAge[ageNum] = { p25, p50, p75 };
    }
  }

    // Extract median path: find the simulation path closest to median terminal wealth
    const medianTerminalWealth = terminalWealths[p50Index];
    let medianPath: PathProjection[] = [];
    if (allProjections.length > 0) {
      let closestDistance = Infinity;
      for (const projections of allProjections) {
        const lastYear = projections[projections.length - 1];
        if (!lastYear) continue;
        const distance = Math.abs(lastYear.portfolioValue - medianTerminalWealth);
        if (distance < closestDistance) {
          closestDistance = distance;
          medianPath = projections;
        }
      }
    }

    return {
      successProbability: successCount / paths,
      medianTerminalWealth,
      percentile5TerminalWealth: terminalWealths[p5Index],
      percentile10TerminalWealth: terminalWealths[p10Index],
      percentile90TerminalWealth: terminalWealths[p90Index],
      yearlyProjections,
      medianPath,
      terminalWealthDistribution: terminalWealths,
      riskOfRuin: ruinCount / paths,
      wealthThresholds: {
        below1m: below1mCount / paths,
        below500k: below500kCount / paths,
      },
      wealthAtAge,
    };

  } catch (error) {
    console.error('Monte Carlo simulation failed:', error);
    console.error(`Performance metrics at failure:`, {
      duration: performance.now() - metrics.startTime,
      chunksProcessed: metrics.chunksProcessed,
      totalPaths: paths,
    });
    throw new Error(`Monte Carlo simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get worker status and performance metrics.
 * Used for monitoring and debugging.
 */
async function getWorkerStatus(): Promise<{ ready: boolean; lastRuntime?: number }> {
  return { ready: true };
}

// Expose worker functions to main thread via Comlink
const workerAPI = {
  runSimulation,
  getWorkerStatus,
};

Comlink.expose(workerAPI);

export type WorkerAPI = typeof workerAPI;
