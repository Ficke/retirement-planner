use anyhow::{anyhow, Result};
use rayon::prelude::*;
use tracing::info;

use crate::simulation::projection::{project_scenario, project_scenario_summary, ProjectionConfig};
use crate::types::{
    BatchSimulationRequest, BatchSimulationSummaryResponse, IncomeSourcesRow, MCConfig, PathResult,
    RetirementPlan, SimulationResult, YearlyProjection,
};

/// The aggregation phase only needs one value per path and year. Keeping the
/// complete cash-flow object for every Monte Carlo path multiplies memory use
/// without improving the percentile calculation.
struct PathSummary {
    terminal_wealth: f64,
    portfolio_values: Vec<f64>,
    success: bool,
}

/// Run Monte Carlo paths in parallel, then aggregate them without retaining
/// every cash-flow field for every path.
pub fn run_simulation(plan: RetirementPlan, config: MCConfig) -> Result<SimulationResult> {
    let start_time = std::time::Instant::now();
    info!(
        "Starting Monte Carlo simulation with {} paths",
        config.paths
    );

    let path_summaries: Vec<PathSummary> = (0..config.paths)
        .into_par_iter()
        .map(|path_index| {
            let result = run_single_path(
                &plan,
                config.seed.wrapping_add(path_index as u64),
                config.use_historical_bootstrap,
                config.block_size,
            )?;
            Ok(PathSummary {
                terminal_wealth: result.terminal_wealth,
                portfolio_values: result
                    .projections
                    .into_iter()
                    .map(|projection| projection.portfolio_value)
                    .collect(),
                success: result.success,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    info!(
        "Completed {} paths in {:?}",
        config.paths,
        start_time.elapsed()
    );

    aggregate_results(&plan, &config, path_summaries)
}

/// Run all sweep points path-major. Each Rayon task owns a local vector of
/// success counts, so the only shared work is the final vector reduction.
pub fn run_sweep(
    simulations: Vec<BatchSimulationRequest>,
) -> Result<Vec<BatchSimulationSummaryResponse>> {
    if simulations.is_empty() {
        return Ok(Vec::new());
    }
    let scenario_count = simulations.len();
    let max_paths = simulations
        .iter()
        .map(|simulation| simulation.config.paths)
        .max()
        .unwrap_or(0);

    let success_counts = (0..max_paths)
        .into_par_iter()
        .try_fold(
            || vec![0_u32; scenario_count],
            |mut counts, path_index| -> Result<Vec<u32>> {
                for (scenario_index, simulation) in simulations.iter().enumerate() {
                    if path_index >= simulation.config.paths {
                        continue;
                    }
                    let summary = project_scenario_summary(
                        &simulation.plan,
                        ProjectionConfig {
                            seed: simulation.config.seed.wrapping_add(path_index as u64),
                            use_historical_bootstrap: simulation.config.use_historical_bootstrap,
                            block_size: simulation.config.block_size,
                        },
                    )?;
                    if summary.success {
                        counts[scenario_index] += 1;
                    }
                }
                Ok(counts)
            },
        )
        .try_reduce(
            || vec![0_u32; scenario_count],
            |mut left, right| -> Result<Vec<u32>> {
                for (left_count, right_count) in left.iter_mut().zip(right) {
                    *left_count += right_count;
                }
                Ok(left)
            },
        )?;

    Ok(simulations
        .into_iter()
        .zip(success_counts)
        .map(
            |(simulation, success_count)| BatchSimulationSummaryResponse {
                id: simulation.id,
                success_probability: success_count as f64 / simulation.config.paths as f64,
            },
        )
        .collect())
}

fn run_single_path(
    plan: &RetirementPlan,
    seed: u64,
    use_historical_bootstrap: bool,
    block_size: usize,
) -> Result<PathResult> {
    project_scenario(
        plan,
        ProjectionConfig {
            seed,
            use_historical_bootstrap,
            block_size,
        },
    )
}

/// Use the median-terminal-wealth path as the cash-flow representative. This
/// keeps withdrawals, deposits, income, spending, and taxes from one outcome;
/// independent field medians can combine unrelated paths and do not reconcile.
fn aggregate_results(
    plan: &RetirementPlan,
    config: &MCConfig,
    path_summaries: Vec<PathSummary>,
) -> Result<SimulationResult> {
    if path_summaries.is_empty() {
        return Err(anyhow!("No simulation paths provided"));
    }

    let path_count = path_summaries.len();
    let percentile_index =
        |quantile: f64| ((path_count as f64 * quantile).floor() as usize).min(path_count - 1);
    let p5_index = percentile_index(0.05);
    let p10_index = percentile_index(0.10);
    let p15_index = percentile_index(0.15);
    let p25_index = percentile_index(0.25);
    let p50_index = percentile_index(0.50);
    let p75_index = percentile_index(0.75);
    let p90_index = percentile_index(0.90);

    let success_count = path_summaries
        .iter()
        .filter(|summary| summary.success)
        .count();
    let success_probability = success_count as f64 / path_count as f64;

    let mut terminal_outcomes: Vec<(f64, usize)> = path_summaries
        .iter()
        .enumerate()
        .map(|(path_index, summary)| (summary.terminal_wealth, path_index))
        .collect();
    terminal_outcomes.sort_by(|a, b| a.0.total_cmp(&b.0));

    let representative_path_index = terminal_outcomes[p50_index].1;
    let representative = run_single_path(
        plan,
        config.seed.wrapping_add(representative_path_index as u64),
        config.use_historical_bootstrap,
        config.block_size,
    )?;

    let year_count = representative.projections.len();
    if path_summaries
        .iter()
        .any(|summary| summary.portfolio_values.len() != year_count)
    {
        return Err(anyhow!(
            "Simulation paths produced inconsistent projection lengths"
        ));
    }

    let mut yearly_projections = Vec::with_capacity(year_count);
    for (year_index, representative_projection) in representative.projections.iter().enumerate() {
        let mut portfolio_values: Vec<f64> = path_summaries
            .iter()
            .map(|summary| summary.portfolio_values[year_index])
            .collect();
        portfolio_values.sort_by(f64::total_cmp);

        let mut base = representative_projection.clone();
        base.portfolio_value = portfolio_values[p50_index];
        yearly_projections.push(YearlyProjection {
            base,
            p5: portfolio_values[p5_index],
            p10: portfolio_values[p10_index],
            p15: portfolio_values[p15_index],
            p25: portfolio_values[p25_index],
            p50: portfolio_values[p50_index],
            p75: portfolio_values[p75_index],
            p90: portfolio_values[p90_index],
        });
    }

    let income_sources_path = representative
        .projections
        .iter()
        .map(|projection| IncomeSourcesRow {
            age: projection.age,
            is_retired: projection.is_retired,
            social_security_benefit: projection.social_security_benefit,
            withdrawal_taxable: projection.withdrawal_taxable,
            withdrawal_traditional: projection.withdrawal_traditional,
            withdrawal_roth: projection.withdrawal_roth,
            withdrawal_hsa: projection.withdrawal_hsa,
        })
        .collect();

    Ok(SimulationResult {
        success_probability,
        median_terminal_wealth: terminal_outcomes[p50_index].0,
        percentile5_terminal_wealth: terminal_outcomes[p5_index].0,
        percentile10_terminal_wealth: terminal_outcomes[p10_index].0,
        percentile90_terminal_wealth: terminal_outcomes[p90_index].0,
        yearly_projections,
        risk_of_ruin: 1.0 - success_probability,
        income_sources_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(spending: f64) -> RetirementPlan {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 3,
            "profile": {
                "birthDate": "1966-01-01",
                "state": "TX",
                "filingStatus": "Single",
                "retirementAge": 65,
                "currentSalary": 100000.0,
                "salaryGrowthRate": 0.01,
                "currentSpending": 60000.0,
                "workingSpendingGrowthRate": 0.0,
                "retirementSpending": spending,
                "retirementSpendingGrowthRate": 0.0,
                "lifeExpectancy": 80,
                "asOfDate": "2026-01-01"
            },
            "accounts": [{
                "type": "Traditional",
                "balance": 1000000.0,
                "assetWeights": { "stocks": 0.6, "bonds": 0.4 }
            }],
            "socialSecurity": {
                "enabled": true,
                "estimatedBenefit": null,
                "claimAge": 67,
                "manualOverride": false
            },
            "assumptions": {
                "simulationModel": "historical",
                "randomSeed": 42,
                "taxableGainRatio": 0.5,
                "hsaEligible": false,
                "useBackdoorRoth": false
            }
        }))
        .unwrap()
    }

    #[test]
    fn path_major_sweep_matches_individual_full_simulations() {
        let common_config = MCConfig {
            paths: 20,
            seed: 42,
            use_historical_bootstrap: true,
            block_size: 3,
        };
        let simulations = vec![
            BatchSimulationRequest {
                id: "lower".into(),
                plan: plan(50_000.0),
                config: common_config.clone(),
            },
            BatchSimulationRequest {
                id: "higher".into(),
                plan: plan(100_000.0),
                config: MCConfig {
                    paths: 7,
                    seed: 123,
                    use_historical_bootstrap: false,
                    block_size: 1,
                },
            },
        ];

        let summaries = run_sweep(simulations.clone()).unwrap();
        for (summary, simulation) in summaries.iter().zip(simulations) {
            let full = run_simulation(simulation.plan, simulation.config).unwrap();
            assert_eq!(summary.id, simulation.id);
            assert_eq!(summary.success_probability, full.success_probability);
        }
    }
}
