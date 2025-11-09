use warp::{Filter, Reply};
use serde_json;
use tracing::{info, error};

use crate::types::SimulationRequest;
use crate::simulation::monte_carlo;

pub fn routes() -> impl Filter<Extract = impl Reply, Error = warp::Rejection> + Clone {
    simulate_route()
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