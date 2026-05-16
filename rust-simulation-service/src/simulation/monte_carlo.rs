use anyhow::Result;
use rayon::prelude::*;
use std::collections::HashMap;
use tracing::info;

use crate::types::{
    RetirementPlan, SimulationResult, PathResult, PathProjection,
    YearlyProjection, MCConfig, WealthThresholds, WealthAtAge, IncomeSourcesRow
};
use crate::simulation::projection::{project_scenario, ProjectionConfig};

/// Run Monte Carlo simulation with specified number of paths
pub async fn run_simulation(
    plan: RetirementPlan,
    config: MCConfig,
) -> Result<SimulationResult> {
    let start_time = std::time::Instant::now();
    
    info!("Starting Monte Carlo simulation with {} paths", config.paths);
    
    // Run simulation paths in parallel using Rayon
    let path_results: Vec<PathResult> = (0..config.paths)
        .into_par_iter()
        .map(|path_index| {
            let path_seed = config.seed.wrapping_add(path_index as u64);
            run_single_path(
                &plan,
                path_seed,
                config.use_historical_bootstrap,
                config.block_size,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    
    let simulation_time = start_time.elapsed();
    info!("Completed {} paths in {:?}", config.paths, simulation_time);
    
    // Aggregate results
    let result = aggregate_results(path_results)?;
    
    Ok(result)
}

/// Run a single simulation path using full projection logic
/// Now uses the complete projection engine with tax calculations, RMDs, Social Security, etc.
fn run_single_path(
    plan: &RetirementPlan,
    seed: u64,
    use_historical_bootstrap: bool,
    block_size: usize,
) -> Result<PathResult> {
    let config = ProjectionConfig {
        seed,
        use_historical_bootstrap,
        block_size,
    };

    project_scenario(plan, config)
}

/// Aggregate multiple path results into final simulation result
fn aggregate_results(mut path_results: Vec<PathResult>) -> Result<SimulationResult> {
    let num_paths = path_results.len() as f64;
    
    if path_results.is_empty() {
        return Err(anyhow::anyhow!("No simulation paths provided"));
    }
    
    // Calculate success metrics
    let success_count = path_results.iter().filter(|r| r.success).count() as f64;
    let success_probability = success_count / num_paths;
    let risk_of_ruin = 1.0 - success_probability;
    
    // Extract terminal wealths and sort for percentile calculation
    let mut terminal_wealths: Vec<f64> = path_results
        .iter()
        .map(|r| r.terminal_wealth)
        .collect();
    terminal_wealths.sort_by(|a, b| a.partial_cmp(b).unwrap());
    
    // Calculate percentiles
    let p5_idx = ((num_paths * 0.05) as usize).min(terminal_wealths.len() - 1);
    let p10_idx = ((num_paths * 0.10) as usize).min(terminal_wealths.len() - 1);
    let p50_idx = ((num_paths * 0.50) as usize).min(terminal_wealths.len() - 1);
    let p90_idx = ((num_paths * 0.90) as usize).min(terminal_wealths.len() - 1);
    
    let percentile5_terminal_wealth = terminal_wealths[p5_idx];
    let percentile10_terminal_wealth = terminal_wealths[p10_idx];
    let median_terminal_wealth = terminal_wealths[p50_idx];
    let percentile90_terminal_wealth = terminal_wealths[p90_idx];
    
    // Calculate wealth thresholds
    let below1m_count = terminal_wealths.iter().filter(|&&w| w < 1_000_000.0).count() as f64;
    let below500k_count = terminal_wealths.iter().filter(|&&w| w < 500_000.0).count() as f64;
    
    let wealth_thresholds = WealthThresholds {
        below1m: below1m_count / num_paths,
        below500k: below500k_count / num_paths,
    };
    
    // Create yearly projections with percentiles
    let yearly_projections = create_yearly_projections(&mut path_results)?;

    // Smoothed income-sources path (mean of [p25, p75] terminal-wealth band)
    let p25_wealth = terminal_wealths[((num_paths * 0.25) as usize).min(terminal_wealths.len() - 1)];
    let p75_wealth = terminal_wealths[((num_paths * 0.75) as usize).min(terminal_wealths.len() - 1)];
    let income_sources_path = create_income_sources_path(&path_results, p25_wealth, p75_wealth);

    // Create wealth at age snapshots
    let wealth_at_age = create_wealth_at_age_snapshots(&path_results);

    Ok(SimulationResult {
        success_probability,
        median_terminal_wealth,
        percentile5_terminal_wealth,
        percentile10_terminal_wealth,
        percentile90_terminal_wealth,
        yearly_projections,
        terminal_wealth_distribution: terminal_wealths,
        risk_of_ruin,
        wealth_thresholds,
        wealth_at_age,
        income_sources_path,
    })
}

fn create_income_sources_path(
    path_results: &[PathResult],
    p25_wealth: f64,
    p75_wealth: f64,
) -> Vec<IncomeSourcesRow> {
    let band: Vec<&PathResult> = path_results
        .iter()
        .filter(|r| r.terminal_wealth >= p25_wealth && r.terminal_wealth <= p75_wealth)
        .collect();

    if band.is_empty() {
        return Vec::new();
    }

    let num_years = band[0].projections.len();
    let mut rows = Vec::with_capacity(num_years);
    for year_idx in 0..num_years {
        let projections: Vec<&PathProjection> = band
            .iter()
            .filter_map(|r| r.projections.get(year_idx))
            .collect();
        if projections.is_empty() {
            continue;
        }
        let n = projections.len() as f64;
        let mean = |sel: fn(&PathProjection) -> f64| -> f64 {
            projections.iter().map(|p| sel(*p)).sum::<f64>() / n
        };
        rows.push(IncomeSourcesRow {
            age: projections[0].age,
            is_retired: projections[0].is_retired,
            social_security_benefit: mean(|p| p.social_security_benefit),
            withdrawal_taxable: mean(|p| p.withdrawal_taxable),
            withdrawal_traditional: mean(|p| p.withdrawal_traditional),
            withdrawal_roth: mean(|p| p.withdrawal_roth),
            withdrawal_hsa: mean(|p| p.withdrawal_hsa),
        });
    }
    rows
}

/// Create yearly projections with percentiles across all paths
/// Aggregates the median of EACH field across all paths for each year
fn create_yearly_projections(path_results: &mut [PathResult]) -> Result<Vec<YearlyProjection>> {
    if path_results.is_empty() {
        return Ok(Vec::new());
    }

    let num_years = path_results[0].projections.len();
    let mut yearly_projections = Vec::with_capacity(num_years);

    for year_idx in 0..num_years {
        // Extract all projections for this year across all paths
        let valid_projections: Vec<&PathProjection> = path_results
            .iter()
            .filter_map(|result| result.projections.get(year_idx))
            .collect();

        if valid_projections.is_empty() {
            continue;
        }

        // Collect values for each field across all paths
        let mut portfolio_values: Vec<f64> = valid_projections.iter().map(|p| p.portfolio_value).collect();
        let mut incomes: Vec<f64> = valid_projections.iter().map(|p| p.income).collect();
        let mut spendings: Vec<f64> = valid_projections.iter().map(|p| p.spending).collect();
        let mut taxes: Vec<f64> = valid_projections.iter().map(|p| p.taxes).collect();
        let mut savings: Vec<f64> = valid_projections.iter().map(|p| p.savings).collect();
        let mut ss_benefits: Vec<f64> = valid_projections.iter().map(|p| p.social_security_benefit).collect();
        let mut withdrawal_taxables: Vec<f64> = valid_projections.iter().map(|p| p.withdrawal_taxable).collect();
        let mut withdrawal_traditionals: Vec<f64> = valid_projections.iter().map(|p| p.withdrawal_traditional).collect();
        let mut withdrawal_roths: Vec<f64> = valid_projections.iter().map(|p| p.withdrawal_roth).collect();
        let mut withdrawal_hsas: Vec<f64> = valid_projections.iter().map(|p| p.withdrawal_hsa).collect();
        let mut rmd_amounts: Vec<f64> = valid_projections.iter().map(|p| p.rmd_amount).collect();
        let mut deposit_taxables: Vec<f64> = valid_projections.iter().map(|p| p.deposit_taxable).collect();
        let mut deposit_traditionals: Vec<f64> = valid_projections.iter().map(|p| p.deposit_traditional).collect();
        let mut deposit_roths: Vec<f64> = valid_projections.iter().map(|p| p.deposit_roth).collect();
        let mut deposit_hsas: Vec<f64> = valid_projections.iter().map(|p| p.deposit_hsa).collect();

        // Sort all arrays for percentile calculation
        portfolio_values.sort_by(|a, b| a.partial_cmp(b).unwrap());
        incomes.sort_by(|a, b| a.partial_cmp(b).unwrap());
        spendings.sort_by(|a, b| a.partial_cmp(b).unwrap());
        taxes.sort_by(|a, b| a.partial_cmp(b).unwrap());
        savings.sort_by(|a, b| a.partial_cmp(b).unwrap());
        ss_benefits.sort_by(|a, b| a.partial_cmp(b).unwrap());
        withdrawal_taxables.sort_by(|a, b| a.partial_cmp(b).unwrap());
        withdrawal_traditionals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        withdrawal_roths.sort_by(|a, b| a.partial_cmp(b).unwrap());
        withdrawal_hsas.sort_by(|a, b| a.partial_cmp(b).unwrap());
        rmd_amounts.sort_by(|a, b| a.partial_cmp(b).unwrap());
        deposit_taxables.sort_by(|a, b| a.partial_cmp(b).unwrap());
        deposit_traditionals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        deposit_roths.sort_by(|a, b| a.partial_cmp(b).unwrap());
        deposit_hsas.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let num_values = portfolio_values.len();
        let p5_idx = ((num_values as f64 * 0.05) as usize).min(num_values - 1);
        let p10_idx = ((num_values as f64 * 0.10) as usize).min(num_values - 1);
        let p15_idx = ((num_values as f64 * 0.15) as usize).min(num_values - 1);
        let p25_idx = ((num_values as f64 * 0.25) as usize).min(num_values - 1);
        let p50_idx = ((num_values as f64 * 0.50) as usize).min(num_values - 1);
        let p75_idx = ((num_values as f64 * 0.75) as usize).min(num_values - 1);
        let p90_idx = ((num_values as f64 * 0.90) as usize).min(num_values - 1);

        // Use first valid path as template for non-financial data (year, age, isRetired)
        let template_projection = valid_projections[0];

        // Create aggregated projection using median values for ALL fields
        let base_projection = PathProjection {
            year: template_projection.year,
            age: template_projection.age,
            portfolio_value: portfolio_values[p50_idx],
            income: incomes[p50_idx],
            spending: spendings[p50_idx],
            taxes: taxes[p50_idx],
            savings: savings[p50_idx],
            social_security_benefit: ss_benefits[p50_idx],
            is_retired: template_projection.is_retired,
            withdrawal_taxable: withdrawal_taxables[p50_idx],
            withdrawal_traditional: withdrawal_traditionals[p50_idx],
            withdrawal_roth: withdrawal_roths[p50_idx],
            withdrawal_hsa: withdrawal_hsas[p50_idx],
            rmd_amount: rmd_amounts[p50_idx],
            deposit_taxable: deposit_taxables[p50_idx],
            deposit_traditional: deposit_traditionals[p50_idx],
            deposit_roth: deposit_roths[p50_idx],
            deposit_hsa: deposit_hsas[p50_idx],
            // For insufficient_funds, use the value from the median portfolio path
            // This represents whether the median outcome had insufficient funds
            insufficient_funds: template_projection.insufficient_funds,
        };

        let yearly_projection = YearlyProjection {
            base: base_projection,
            p5: portfolio_values[p5_idx],
            p10: portfolio_values[p10_idx],
            p15: portfolio_values[p15_idx],
            p25: portfolio_values[p25_idx],
            p50: portfolio_values[p50_idx],
            p75: portfolio_values[p75_idx],
            p90: portfolio_values[p90_idx],
        };

        yearly_projections.push(yearly_projection);
    }

    Ok(yearly_projections)
}

/// Create wealth snapshots at specific ages
fn create_wealth_at_age_snapshots(path_results: &[PathResult]) -> HashMap<u32, WealthAtAge> {
    let mut wealth_at_age = HashMap::new();
    let snapshot_ages = [65, 75, 85, 95];
    
    for &target_age in &snapshot_ages {
        let mut wealth_values: Vec<f64> = path_results
            .iter()
            .filter_map(|result| {
                result.projections
                    .iter()
                    .find(|proj| proj.age == target_age)
                    .map(|proj| proj.portfolio_value)
            })
            .collect();
        
        if !wealth_values.is_empty() {
            wealth_values.sort_by(|a, b| a.partial_cmp(b).unwrap());
            
            let num_values = wealth_values.len() as f64;
            let p25_idx = ((num_values * 0.25) as usize).min(wealth_values.len() - 1);
            let p50_idx = ((num_values * 0.50) as usize).min(wealth_values.len() - 1);
            let p75_idx = ((num_values * 0.75) as usize).min(wealth_values.len() - 1);
            
            wealth_at_age.insert(target_age, WealthAtAge {
                p25: wealth_values[p25_idx],
                p50: wealth_values[p50_idx],
                p75: wealth_values[p75_idx],
            });
        }
    }
    
    wealth_at_age
}