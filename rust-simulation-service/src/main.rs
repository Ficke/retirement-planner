use std::env;
use warp::Filter;
use tracing::info;

mod types;
mod simulation;
mod server;

use crate::server::routes;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .init();

    // Load environment variables
    dotenv::dotenv().ok();

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse::<u16>()
        .expect("PORT must be a valid port number");

    info!("Starting retirement simulation service on port {}", port);

    // Build routes
    let routes = routes();

    // Health check endpoint
    let health = warp::path("health")
        .and(warp::get())
        .map(|| {
            warp::reply::json(&serde_json::json!({
                "status": "healthy",
                "service": "retirement-simulation",
                "version": env!("CARGO_PKG_VERSION")
            }))
        });

    let all_routes = health.or(routes);

    // Start server
    info!("Retirement simulation service running on http://0.0.0.0:{}", port);
    
    warp::serve(all_routes)
        .run(([0, 0, 0, 0], port))
        .await;

    Ok(())
}