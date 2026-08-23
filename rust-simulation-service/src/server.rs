use std::{convert::Infallible, sync::Arc, time::Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tracing::{error, info};
use warp::{Filter, Reply};

use crate::simulation::age::age_on;
use crate::simulation::monte_carlo;
use crate::types::{
    BatchRequest, BatchResponse, BatchResponseMode, BatchSimulationResponse, BatchSummaryResponse,
    MCConfig, RetirementPlan, SimulationRequest, SimulationResult, PLAN_SCHEMA_VERSION,
};

const MAX_PATHS: u32 = 5_000;
const MAX_BATCH_SIMULATIONS: usize = 40;
const MAX_BATCH_PATHS: u32 = 40_000;

struct CancelOnDrop {
    cancellation: monte_carlo::CancellationToken,
    completed: bool,
}

impl CancelOnDrop {
    fn new(cancellation: monte_carlo::CancellationToken) -> Self {
        Self {
            cancellation,
            completed: false,
        }
    }

    fn complete(mut self) {
        self.completed = true;
    }
}

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if !self.completed {
            self.cancellation.cancel();
        }
    }
}

async fn acquire_simulation_slot(
    simulation_slots: Arc<Semaphore>,
    request_kind: &str,
) -> Result<OwnedSemaphorePermit, String> {
    let queued_at = Instant::now();
    let permit = simulation_slots
        .acquire_owned()
        .await
        .map_err(|_| "simulation concurrency limiter closed".to_string())?;
    info!(
        request_kind,
        queue_ms = queued_at.elapsed().as_secs_f64() * 1000.0,
        "Simulation request acquired compute slot"
    );
    Ok(permit)
}

pub fn routes(
    simulation_slots: Arc<Semaphore>,
) -> impl Filter<Extract = impl Reply, Error = warp::Rejection> + Clone {
    simulate_route(simulation_slots.clone()).or(batch_route(simulation_slots))
}

fn with_simulation_slots(
    simulation_slots: Arc<Semaphore>,
) -> impl Filter<Extract = (Arc<Semaphore>,), Error = Infallible> + Clone {
    warp::any().map(move || simulation_slots.clone())
}

fn simulate_route(
    simulation_slots: Arc<Semaphore>,
) -> impl Filter<Extract = impl Reply, Error = warp::Rejection> + Clone {
    warp::path("api")
        .and(warp::path("simulate"))
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::content_length_limit(256 * 1024))
        .and(warp::body::json())
        .and(with_simulation_slots(simulation_slots))
        .and_then(handle_simulate)
}

async fn handle_simulate(
    request: SimulationRequest,
    simulation_slots: Arc<Semaphore>,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    if let Err(message) = validate_simulation_request(&request) {
        return Ok(bad_request(message));
    }
    info!(
        "Received simulation request for {} paths",
        request.config.paths
    );

    let permit = match acquire_simulation_slot(simulation_slots, "headline").await {
        Ok(permit) => permit,
        Err(error) => return Ok(internal_error("Simulation unavailable", error)),
    };
    let cancellation = monte_carlo::CancellationToken::default();
    let cancel_on_drop = CancelOnDrop::new(cancellation.clone());
    let result = run_simulation_blocking(request.plan, request.config, cancellation, permit).await;
    cancel_on_drop.complete();

    match result {
        Ok(result) => {
            info!("Simulation completed successfully");
            Ok(Box::new(warp::reply::json(&result)))
        }
        Err(e) => {
            error!("Simulation failed: {}", e);
            let error_response = warp::reply::json(&serde_json::json!({
                "error": "Simulation failed",
                "message": e.to_string()
            }));
            Ok(Box::new(warp::reply::with_status(
                error_response,
                warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )))
        }
    }
}

fn batch_route(
    simulation_slots: Arc<Semaphore>,
) -> impl Filter<Extract = impl Reply, Error = warp::Rejection> + Clone {
    warp::path("api")
        .and(warp::path("batch"))
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::content_length_limit(256 * 1024))
        .and(warp::body::json())
        .and(with_simulation_slots(simulation_slots))
        .and_then(handle_batch)
}

async fn handle_batch(
    request: BatchRequest,
    simulation_slots: Arc<Semaphore>,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    if request.simulations.is_empty() || request.simulations.len() > MAX_BATCH_SIMULATIONS {
        return Ok(bad_request(format!(
            "Batch must contain 1 to {MAX_BATCH_SIMULATIONS} simulations"
        )));
    }
    for simulation in &request.simulations {
        if let Err(message) = validate_simulation_request(&SimulationRequest {
            plan: simulation.plan.clone(),
            config: simulation.config.clone(),
        }) {
            return Ok(bad_request(format!(
                "Simulation '{}': {message}",
                simulation.id
            )));
        }
    }
    let num_sims = request.simulations.len();
    let total_paths: u32 = request.simulations.iter().map(|s| s.config.paths).sum();
    if total_paths > MAX_BATCH_PATHS {
        return Ok(bad_request(format!(
            "Batch may not exceed {MAX_BATCH_PATHS} total paths"
        )));
    }

    info!(
        "Received batch request: {} simulations, {} total paths",
        num_sims, total_paths
    );

    let permit = match acquire_simulation_slot(simulation_slots, "batch").await {
        Ok(permit) => permit,
        Err(error) => return Ok(internal_error("Batch simulation unavailable", error)),
    };
    let cancellation = monte_carlo::CancellationToken::default();
    let cancel_on_drop = CancelOnDrop::new(cancellation.clone());

    if request.response_mode == BatchResponseMode::Summary {
        let simulations = request.simulations;
        let job_cancellation = cancellation.clone();
        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let started_at = Instant::now();
            let result = monte_carlo::run_sweep_cancellable(simulations, job_cancellation.clone());
            info!(
                request_kind = "batch-summary",
                compute_ms = started_at.elapsed().as_secs_f64() * 1000.0,
                canceled = job_cancellation.is_cancelled(),
                "Simulation compute finished"
            );
            if job_cancellation.is_cancelled() {
                info!("Canceled summary batch stopped");
            }
            result
        })
        .await;
        cancel_on_drop.complete();
        return match result {
            Ok(Ok(results)) => {
                info!(
                    "Summary batch completed: all {} simulations successful",
                    results.len()
                );
                Ok(Box::new(warp::reply::json(&BatchSummaryResponse {
                    results,
                })))
            }
            Ok(Err(error)) => {
                error!("Summary batch failed: {}", error);
                Ok(internal_error("Batch simulation failed", error.to_string()))
            }
            Err(error) => {
                error!("Summary batch task failed: {}", error);
                Ok(internal_error(
                    "Batch simulation task failed",
                    error.to_string(),
                ))
            }
        };
    }

    // Preserve the full response shape for browser bundles deployed before summary mode.
    let simulations = request.simulations;
    let job_cancellation = cancellation.clone();
    let results = match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let started_at = Instant::now();
        let mut results: Vec<Result<BatchSimulationResponse, String>> =
            Vec::with_capacity(num_sims);
        for sim_req in simulations {
            if job_cancellation.is_cancelled() {
                break;
            }
            let id = sim_req.id;
            info!(
                "Running simulation '{}' with {} paths",
                id, sim_req.config.paths
            );
            let result = match monte_carlo::run_simulation_cancellable(
                sim_req.plan,
                sim_req.config,
                job_cancellation.clone(),
            ) {
                Ok(result) => Ok(BatchSimulationResponse { id, result }),
                Err(error) => {
                    error!("Simulation '{}' failed: {}", id, error);
                    Err(format!("Simulation '{}' failed: {}", id, error))
                }
            };
            results.push(result);
        }
        info!(
            request_kind = "batch-full",
            compute_ms = started_at.elapsed().as_secs_f64() * 1000.0,
            canceled = job_cancellation.is_cancelled(),
            "Simulation compute finished"
        );
        if job_cancellation.is_cancelled() {
            info!("Canceled full batch stopped");
        }
        results
    })
    .await
    {
        Ok(results) => results,
        Err(error) => {
            cancel_on_drop.complete();
            return Ok(internal_error(
                "Batch simulation task failed",
                error.to_string(),
            ));
        }
    };
    cancel_on_drop.complete();

    let mut successful_results = Vec::new();
    let mut errors = Vec::new();

    for result in results {
        match result {
            Ok(sim_result) => successful_results.push(sim_result),
            Err(e) => errors.push(e),
        }
    }

    if !errors.is_empty() {
        error!("Batch simulation had {} failures", errors.len());
        let error_response = warp::reply::json(&serde_json::json!({
            "error": "Some simulations failed",
            "failures": errors,
            "successCount": successful_results.len(),
            "failureCount": errors.len()
        }));
        Ok(Box::new(warp::reply::with_status(
            error_response,
            warp::http::StatusCode::PARTIAL_CONTENT,
        )))
    } else {
        info!(
            "Batch simulation completed: all {} simulations successful",
            successful_results.len()
        );
        Ok(Box::new(warp::reply::json(&BatchResponse {
            results: successful_results,
        })))
    }
}

async fn run_simulation_blocking(
    plan: RetirementPlan,
    config: MCConfig,
    cancellation: monte_carlo::CancellationToken,
    permit: OwnedSemaphorePermit,
) -> Result<SimulationResult, String> {
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let started_at = Instant::now();
        let result = monte_carlo::run_simulation_cancellable(plan, config, cancellation.clone());
        info!(
            request_kind = "headline",
            compute_ms = started_at.elapsed().as_secs_f64() * 1000.0,
            canceled = cancellation.is_cancelled(),
            "Simulation compute finished"
        );
        if cancellation.is_cancelled() {
            info!("Canceled headline simulation stopped");
        }
        result
    })
    .await
    .map_err(|error| format!("simulation task failed: {error}"))?
    .map_err(|error| error.to_string())
}

fn internal_error(message: &str, details: String) -> Box<dyn Reply> {
    Box::new(warp::reply::with_status(
        warp::reply::json(&serde_json::json!({
            "error": message,
            "message": details,
        })),
        warp::http::StatusCode::INTERNAL_SERVER_ERROR,
    ))
}

fn bad_request(message: String) -> Box<dyn Reply> {
    Box::new(warp::reply::with_status(
        warp::reply::json(&serde_json::json!({ "error": message })),
        warp::http::StatusCode::BAD_REQUEST,
    ))
}

fn validate_simulation_request(request: &SimulationRequest) -> Result<(), String> {
    if request.config.paths == 0 || request.config.paths > MAX_PATHS {
        return Err(format!("paths must be between 1 and {MAX_PATHS}"));
    }
    if request.config.seed > u32::MAX as u64 {
        return Err("seed must be a 32-bit unsigned integer".into());
    }
    if !(1..=10).contains(&request.config.block_size) {
        return Err("blockSize must be between 1 and 10".into());
    }
    validate_plan(&request.plan)
}

fn validate_plan(plan: &RetirementPlan) -> Result<(), String> {
    if plan.schema_version > PLAN_SCHEMA_VERSION {
        return Err(format!(
            "schemaVersion {} is newer than supported version {PLAN_SCHEMA_VERSION}",
            plan.schema_version
        ));
    }
    let profile = &plan.profile;
    if profile.retirement_age < 45 || profile.retirement_age > 100 {
        return Err("retirementAge must be between 45 and 100".into());
    }
    let Ok(as_of_date) = chrono::NaiveDate::parse_from_str(&profile.as_of_date, "%Y-%m-%d") else {
        return Err("asOfDate must use YYYY-MM-DD".into());
    };
    if !(1900..=2200).contains(&chrono::Datelike::year(&as_of_date)) {
        return Err("asOfDate year must be between 1900 and 2200".into());
    }
    // Age derives from birthDate, so it cannot contradict another stored field.
    let Ok(age) = age_on(&profile.birth_date, &profile.as_of_date) else {
        return Err("birthDate must use YYYY-MM-DD and precede asOfDate".into());
    };
    if !(18..=100).contains(&age) {
        return Err("age at asOfDate must be between 18 and 100".into());
    }
    if profile.life_expectancy <= profile.retirement_age
        || profile.life_expectancy <= age
        || profile.life_expectancy > 120
    {
        return Err(
            "lifeExpectancy must be after current and retirement ages and no greater than 120"
                .into(),
        );
    }
    let finite_profile_values = [
        profile.current_salary,
        profile.salary_growth_rate,
        profile.current_spending,
        profile.working_spending_growth_rate,
        profile.retirement_spending,
        profile.retirement_spending_growth_rate,
    ];
    if !finite_profile_values.iter().all(|value| value.is_finite())
        || profile.current_salary < 0.0
        || profile.current_salary > 1_000_000_000.0
        || profile.current_spending < 0.0
        || profile.current_spending > 1_000_000_000.0
        || profile.retirement_spending < 0.0
        || profile.retirement_spending > 1_000_000_000.0
        || !(-0.1..=0.2).contains(&profile.salary_growth_rate)
        || !(-0.1..=0.1).contains(&profile.working_spending_growth_rate)
        || !(-0.1..=0.1).contains(&profile.retirement_spending_growth_rate)
    {
        return Err(
            "profile amounts and rates must be finite and nonnegative where applicable".into(),
        );
    }
    if !(62..=70).contains(&plan.social_security.claim_age) {
        return Err("claimAge must be between 62 and 70".into());
    }
    if let Some(benefit) = plan.social_security.estimated_benefit {
        if !benefit.is_finite() || !(0.0..=10_000_000.0).contains(&benefit) {
            return Err("estimatedBenefit must be finite and between 0 and 10000000".into());
        }
    }
    if plan.accounts.len() > 20 {
        return Err("plan may contain at most 20 accounts".into());
    }
    if plan.assumptions.random_seed > u32::MAX as u64 {
        return Err("randomSeed must be a 32-bit unsigned integer".into());
    }
    if !plan.assumptions.taxable_gain_ratio.is_finite()
        || !(0.0..=1.0).contains(&plan.assumptions.taxable_gain_ratio)
    {
        return Err("taxableGainRatio must be between 0 and 1".into());
    }
    if !plan.assumptions.terminal_tax_rate.is_finite()
        || !(0.0..=1.0).contains(&plan.assumptions.terminal_tax_rate)
    {
        return Err("terminalTaxRate must be between 0 and 1".into());
    }
    for (index, account) in plan.accounts.iter().enumerate() {
        let weights = &account.asset_weights;
        if !account.balance.is_finite()
            || account.balance < 0.0
            || account.balance > 1_000_000_000_000_000.0
            || !weights.stocks.is_finite()
            || !weights.bonds.is_finite()
            || !(0.0..=1.0).contains(&weights.stocks)
            || !(0.0..=1.0).contains(&weights.bonds)
            || (weights.stocks + weights.bonds - 1.0).abs() > 0.001
        {
            return Err(format!(
                "account {} has invalid balance or allocation",
                index + 1
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_plan_without_accounts() {
        let plan: RetirementPlan = serde_json::from_value(serde_json::json!({
            "profile": {
                "birthDate": "1985-06-15",
                "state": "CA",
                "filingStatus": "Single",
                "retirementAge": 65,
                "currentSalary": 100000.0,
                "salaryGrowthRate": 0.02,
                "currentSpending": 60000.0,
                "desiredSpending": 50000.0,
                "spendingGrowthRate": 0.02,
                "lifeExpectancy": 90,
                "asOfDate": "2025-01-01"
            },
            "accounts": [],
            "socialSecurity": {
                "enabled": true,
                "estimatedBenefit": 24000.0,
                "claimAge": 67,
                "manualOverride": true
            },
            "assumptions": {
                "simulationModel": "historical",
                "randomSeed": 42,
                "taxableGainRatio": 0.5,
                "hsaEligible": false,
                "useBackdoorRoth": true
            }
        }))
        .expect("test plan should deserialize");

        assert_eq!(plan.schema_version, 0);
        assert_eq!(plan.profile.working_spending_growth_rate, 0.0);
        assert_eq!(plan.profile.retirement_spending, 50_000.0);
        assert_eq!(plan.profile.retirement_spending_growth_rate, 0.02);
        assert_eq!(validate_plan(&plan), Ok(()));

        let mut current = plan.clone();
        current.schema_version = PLAN_SCHEMA_VERSION;
        current.profile.working_spending_growth_rate = 0.01;
        assert_eq!(validate_plan(&current), Ok(()));

        current.schema_version = PLAN_SCHEMA_VERSION + 1;
        assert!(validate_plan(&current)
            .unwrap_err()
            .contains("newer than supported"));

        let mut oversized_plan_seed = plan.clone();
        oversized_plan_seed.assumptions.random_seed = u32::MAX as u64 + 1;
        assert_eq!(
            validate_plan(&oversized_plan_seed),
            Err("randomSeed must be a 32-bit unsigned integer".into())
        );

        let request = SimulationRequest {
            plan,
            config: MCConfig {
                paths: 1,
                seed: u32::MAX as u64 + 1,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        };
        assert_eq!(
            validate_simulation_request(&request),
            Err("seed must be a 32-bit unsigned integer".into())
        );
    }

    #[test]
    fn dropping_an_incomplete_request_cancels_its_compute() {
        let cancellation = monte_carlo::CancellationToken::default();
        {
            let _cancel_on_drop = CancelOnDrop::new(cancellation.clone());
        }
        assert!(cancellation.is_cancelled());
    }

    #[test]
    fn completing_a_request_does_not_cancel_its_compute() {
        let cancellation = monte_carlo::CancellationToken::default();
        CancelOnDrop::new(cancellation.clone()).complete();
        assert!(!cancellation.is_cancelled());
    }
}
