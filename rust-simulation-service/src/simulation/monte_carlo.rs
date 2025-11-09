use anyhow::Result;
use rayon::prelude::*;
use rand::SeedableRng;
// Note: Normal distributions moved to parametric_returns module
use std::collections::HashMap;
use tracing::info;

use crate::types::{
    RetirementPlan, SimulationResult, PathResult, PathProjection, 
    YearlyProjection, MCConfig, WealthThresholds, WealthAtAge
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
            run_single_path(&plan, path_seed, config.real_dollars)
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
    real_dollars: bool,
) -> Result<PathResult> {
    let config = ProjectionConfig {
        paths: 1,
        seed,
        real_dollars,
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
    })
}

/// Create yearly projections with percentiles across all paths
fn create_yearly_projections(path_results: &mut [PathResult]) -> Result<Vec<YearlyProjection>> {
    if path_results.is_empty() {
        return Ok(Vec::new());
    }
    
    let num_years = path_results[0].projections.len();
    let mut yearly_projections = Vec::with_capacity(num_years);
    
    for year_idx in 0..num_years {
        // Extract all portfolio values for this year
        let mut year_values: Vec<f64> = path_results
            .iter()
            .filter_map(|result| result.projections.get(year_idx))
            .map(|proj| proj.portfolio_value)
            .collect();
        
        if year_values.is_empty() {
            continue;
        }
        
        year_values.sort_by(|a, b| a.partial_cmp(b).unwrap());
        
        let num_values = year_values.len() as f64;
        let p5_idx = ((num_values * 0.05) as usize).min(year_values.len() - 1);
        let p10_idx = ((num_values * 0.10) as usize).min(year_values.len() - 1);
        let p15_idx = ((num_values * 0.15) as usize).min(year_values.len() - 1);
        let p25_idx = ((num_values * 0.25) as usize).min(year_values.len() - 1);
        let p50_idx = ((num_values * 0.50) as usize).min(year_values.len() - 1);
        let p75_idx = ((num_values * 0.75) as usize).min(year_values.len() - 1);
        let p90_idx = ((num_values * 0.90) as usize).min(year_values.len() - 1);
        
        // Use the median path as the base projection
        let base_projection = &path_results[p50_idx].projections[year_idx];
        
        let yearly_projection = YearlyProjection {
            base: base_projection.clone(),
            p5: year_values[p5_idx],
            p10: year_values[p10_idx],
            p15: year_values[p15_idx],
            p25: year_values[p25_idx],
            p50: year_values[p50_idx],
            p75: year_values[p75_idx],
            p90: year_values[p90_idx],
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