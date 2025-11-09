use warp::{Filter, Reply};
use serde_json;
use tracing::{info, error};
use futures::future::join_all;

use crate::types::{SimulationRequest, BatchRequest, BatchResponse, BatchSimulationResponse};
use crate::simulation::monte_carlo;

pub fn routes() -> impl Filter<Extract = impl Reply, Error = warp::Rejection> + Clone {
    simulate_route().or(batch_route())
}

fn simulate_route() -> impl Filter<Extract = impl Reply, Error = warp::Rejection> + Clone {
    warp::path("api")
        .and(warp::path("simulate"))
        .and(warp::post())
        .and(warp::body::json())
        .and_then(handle_simulate)
}

async fn handle_simulate(
    request: SimulationRequest,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    info!("Received simulation request for {} paths", request.config.paths);

    match monte_carlo::run_simulation(request.plan, request.config).await {
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

fn batch_route() -> impl Filter<Extract = impl Reply, Error = warp::Rejection> + Clone {
    warp::path("api")
        .and(warp::path("batch"))
        .and(warp::post())
        .and(warp::body::json())
        .and_then(handle_batch)
}

async fn handle_batch(
    request: BatchRequest,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    let num_sims = request.simulations.len();
    let total_paths: u32 = request.simulations.iter().map(|s| s.config.paths).sum();

    info!("Received batch request: {} simulations, {} total paths", num_sims, total_paths);

    // Spawn each simulation as a separate Tokio task for true concurrency
    // Each simulation will use Rayon internally for path parallelization
    let handles = request.simulations.into_iter().map(|sim_req| {
        tokio::spawn(async move {
            let id = sim_req.id.clone();
            info!("Running simulation '{}' with {} paths", id, sim_req.config.paths);

            match monte_carlo::run_simulation(sim_req.plan, sim_req.config).await {
                Ok(result) => {
                    info!("Simulation '{}' completed successfully", id);
                    Ok(BatchSimulationResponse { id, result })
                }
                Err(e) => {
                    error!("Simulation '{}' failed: {}", id, e);
                    Err(format!("Simulation '{}' failed: {}", id, e))
                }
            }
        })
    });

    let results: Vec<Result<BatchSimulationResponse, String>> = join_all(handles)
        .await
        .into_iter()
        .map(|join_result| {
            join_result.unwrap_or_else(|e| Err(format!("Task panicked: {}", e)))
        })
        .collect();

    // Check if any simulations failed
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
        info!("Batch simulation completed: all {} simulations successful", successful_results.len());
        Ok(Box::new(warp::reply::json(&BatchResponse {
            results: successful_results,
        })))
    }
}