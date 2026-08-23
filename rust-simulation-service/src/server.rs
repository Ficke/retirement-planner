use std::{convert::Infallible, sync::Arc, time::Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tracing::{error, info};
use warp::{Filter, Reply};

use crate::simulation::monte_carlo;
use crate::types::{
    BatchRequest, BatchResponse, BatchResponseMode, BatchSimulationResponse, BatchSummaryResponse,
    MCConfig, RetirementPlan, SimulationRequest, SimulationResult,
};
use crate::validation::{validate_batch_simulations, validate_simulation_request};

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
    let total_paths = match validate_batch_simulations(&request.simulations) {
        Ok(total_paths) => total_paths,
        Err(message) => return Ok(bad_request(message)),
    };
    let num_sims = request.simulations.len();

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PLAN_SCHEMA_VERSION;
    use crate::validation::validate_plan;

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

        let request = SimulationRequest {
            plan,
            config: MCConfig {
                paths: 1,
                seed: u32::MAX,
                use_historical_bootstrap: true,
                block_size: 3,
            },
        };
        assert_eq!(validate_simulation_request(&request), Ok(()));
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
