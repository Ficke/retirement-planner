use anyhow::{anyhow, Result};
use rayon::prelude::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tracing::info;

use crate::simulation::projection::{project_scenario, project_scenario_summary, ProjectionConfig};
use crate::types::{
    BatchSimulationRequest, BatchSimulationSummaryResponse, MCConfig, OutcomeBucket,
    OutcomeCashFlowRow, PathResult, RetirementPlan, SimulationResult, YearlyProjection,
};

const OUTCOME_CENTERS: [u32; 9] = [10, 20, 30, 40, 50, 60, 70, 80, 90];

#[derive(Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn ensure_active(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(anyhow!("Simulation canceled"))
        } else {
            Ok(())
        }
    }
}

/// The aggregation phase only needs one value per path and year. Keeping the
/// complete cash-flow object for every Monte Carlo path multiplies memory use
/// without improving the percentile calculation.
struct PathSummary {
    terminal_wealth: f64,
    after_tax_terminal_wealth: f64,
    portfolio_values: Vec<f64>,
    cash_flows: Vec<OutcomeCashFlowRow>,
    success: bool,
}

/// Run Monte Carlo paths in parallel, then aggregate them without retaining
/// every cash-flow field for every path.
#[cfg(test)]
pub fn run_simulation(plan: RetirementPlan, config: MCConfig) -> Result<SimulationResult> {
    run_simulation_cancellable(plan, config, CancellationToken::default())
}

pub fn run_simulation_cancellable(
    plan: RetirementPlan,
    config: MCConfig,
    cancellation: CancellationToken,
) -> Result<SimulationResult> {
    let start_time = std::time::Instant::now();
    info!(
        "Starting Monte Carlo simulation with {} paths",
        config.paths
    );

    let path_summaries: Vec<PathSummary> = (0..config.paths)
        .into_par_iter()
        .map(|path_index| {
            cancellation.ensure_active()?;
            let result = run_single_path(
                &plan,
                config.seed.wrapping_add(path_index as u64),
                config.use_historical_bootstrap,
                config.block_size,
            )?;
            let terminal_wealth = result.terminal_wealth;
            let after_tax_terminal_wealth = result.after_tax_terminal_wealth;
            let success = result.success;
            let mut portfolio_values = Vec::with_capacity(result.projections.len());
            let mut cash_flows = Vec::with_capacity(result.projections.len());
            for projection in result.projections {
                portfolio_values.push(projection.portfolio_value);
                cash_flows.push(OutcomeCashFlowRow {
                    age: projection.age,
                    is_retired: projection.is_retired,
                    income: projection.income,
                    spending: projection.spending,
                    taxes: projection.taxes,
                    savings: projection.savings,
                    social_security_benefit: projection.social_security_benefit,
                    withdrawal_taxable: projection.withdrawal_taxable,
                    withdrawal_traditional: projection.withdrawal_traditional,
                    withdrawal_roth: projection.withdrawal_roth,
                    withdrawal_hsa: projection.withdrawal_hsa,
                    healthcare_cost: projection.healthcare_cost,
                });
            }
            Ok(PathSummary {
                terminal_wealth,
                after_tax_terminal_wealth,
                portfolio_values,
                cash_flows,
                success,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    cancellation.ensure_active()?;

    info!(
        "Completed {} paths in {:?}",
        config.paths,
        start_time.elapsed()
    );

    aggregate_results(&plan, &config, path_summaries, &cancellation)
}

/// Run all sweep points path-major. Each Rayon task owns a local vector of
/// success counts, so the only shared work is the final vector reduction.
#[cfg(test)]
pub fn run_sweep(
    simulations: Vec<BatchSimulationRequest>,
) -> Result<Vec<BatchSimulationSummaryResponse>> {
    run_sweep_cancellable(simulations, CancellationToken::default())
}

pub fn run_sweep_cancellable(
    simulations: Vec<BatchSimulationRequest>,
    cancellation: CancellationToken,
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
                cancellation.ensure_active()?;
                for (scenario_index, simulation) in simulations.iter().enumerate() {
                    cancellation.ensure_active()?;
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

    cancellation.ensure_active()?;

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
    cancellation: &CancellationToken,
) -> Result<SimulationResult> {
    cancellation.ensure_active()?;
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

    let mut terminal_outcomes: Vec<(f64, usize, f64)> = path_summaries
        .iter()
        .enumerate()
        .map(|(path_index, summary)| {
            (
                summary.terminal_wealth,
                path_index,
                summary.after_tax_terminal_wealth,
            )
        })
        .collect();
    terminal_outcomes.sort_by(|a, b| a.0.total_cmp(&b.0));

    let representative_path_index = terminal_outcomes[p50_index].1;
    cancellation.ensure_active()?;
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
        cancellation.ensure_active()?;
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

    let outcome_buckets = OUTCOME_CENTERS
        .into_iter()
        .map(|center_percentile| -> Result<OutcomeBucket> {
            cancellation.ensure_active()?;
            let lower_percentile = center_percentile - 5;
            let upper_percentile = center_percentile + 5;
            let start = ((path_count * lower_percentile as usize) / 100).min(path_count - 1);
            let end = ((path_count * upper_percentile as usize) / 100)
                .max(start + 1)
                .min(path_count);
            let cohort = &terminal_outcomes[start..end];
            let count = cohort.len() as f64;
            let projections = (0..year_count)
                .map(|year_index| {
                    let first = &path_summaries[cohort[0].1].cash_flows[year_index];
                    let mut mean = OutcomeCashFlowRow {
                        age: first.age,
                        is_retired: first.is_retired,
                        income: 0.0,
                        spending: 0.0,
                        taxes: 0.0,
                        savings: 0.0,
                        social_security_benefit: 0.0,
                        withdrawal_taxable: 0.0,
                        withdrawal_traditional: 0.0,
                        withdrawal_roth: 0.0,
                        withdrawal_hsa: 0.0,
                        healthcare_cost: 0.0,
                    };
                    for (_, path_index, _) in cohort {
                        let row = &path_summaries[*path_index].cash_flows[year_index];
                        mean.income += row.income;
                        mean.spending += row.spending;
                        mean.taxes += row.taxes;
                        mean.savings += row.savings;
                        mean.social_security_benefit += row.social_security_benefit;
                        mean.withdrawal_taxable += row.withdrawal_taxable;
                        mean.withdrawal_traditional += row.withdrawal_traditional;
                        mean.withdrawal_roth += row.withdrawal_roth;
                        mean.withdrawal_hsa += row.withdrawal_hsa;
                        mean.healthcare_cost += row.healthcare_cost;
                    }
                    mean.income /= count;
                    mean.spending /= count;
                    mean.taxes /= count;
                    mean.savings /= count;
                    mean.social_security_benefit /= count;
                    mean.withdrawal_taxable /= count;
                    mean.withdrawal_traditional /= count;
                    mean.withdrawal_roth /= count;
                    mean.withdrawal_hsa /= count;
                    mean.healthcare_cost /= count;
                    mean
                })
                .collect();
            let bucket_successes = cohort
                .iter()
                .filter(|(_, path_index, _)| path_summaries[*path_index].success)
                .count();
            Ok(OutcomeBucket {
                center_percentile,
                lower_percentile,
                upper_percentile,
                success_probability: bucket_successes as f64 / count,
                projections,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(SimulationResult {
        success_probability,
        median_terminal_wealth: terminal_outcomes[p50_index].0,
        // Read off the same path as the median, not a separately ordered
        // distribution, so the pair describes one outcome rather than two.
        median_after_tax_terminal_wealth: terminal_outcomes[p50_index].2,
        percentile5_terminal_wealth: terminal_outcomes[p5_index].0,
        percentile10_terminal_wealth: terminal_outcomes[p10_index].0,
        percentile90_terminal_wealth: terminal_outcomes[p90_index].0,
        yearly_projections,
        risk_of_ruin: 1.0 - success_probability,
        outcome_buckets,
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

    #[test]
    fn full_simulation_returns_centered_outcome_buckets() {
        let result = run_simulation(
            plan(60_000.0),
            MCConfig {
                paths: 100,
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        )
        .unwrap();

        assert_eq!(result.outcome_buckets.len(), 9);
        for (bucket, center) in result.outcome_buckets.iter().zip(OUTCOME_CENTERS) {
            assert_eq!(bucket.center_percentile, center);
            assert_eq!(bucket.lower_percentile, center - 5);
            assert_eq!(bucket.upper_percentile, center + 5);
            assert_eq!(bucket.projections.len(), result.yearly_projections.len());
            assert!((0.0..=1.0).contains(&bucket.success_probability));
            assert!(bucket.projections.iter().all(|row| {
                row.income.is_finite()
                    && row.spending.is_finite()
                    && row.taxes.is_finite()
                    && row.savings.is_finite()
                    && row.social_security_benefit.is_finite()
                    && row.withdrawal_taxable.is_finite()
                    && row.withdrawal_traditional.is_finite()
                    && row.withdrawal_roth.is_finite()
                    && row.withdrawal_hsa.is_finite()
            }));
        }

        let median = &result.outcome_buckets[4];
        assert_eq!((median.lower_percentile, median.upper_percentile), (45, 55));
    }

    #[test]
    fn canceled_simulation_stops_before_projecting_paths() {
        let cancellation = CancellationToken::default();
        cancellation.cancel();

        let result = run_simulation_cancellable(
            plan(60_000.0),
            MCConfig {
                paths: 100,
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
            cancellation,
        );

        assert_eq!(result.unwrap_err().to_string(), "Simulation canceled");
    }

    #[test]
    fn canceled_sweep_stops_before_projecting_scenarios() {
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        let simulation = BatchSimulationRequest {
            id: "canceled".into(),
            plan: plan(60_000.0),
            config: MCConfig {
                paths: 100,
                seed: 42,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        };

        let result = run_sweep_cancellable(vec![simulation], cancellation);

        assert_eq!(result.unwrap_err().to_string(), "Simulation canceled");
    }
}
