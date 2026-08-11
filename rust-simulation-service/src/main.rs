use std::env;
use tracing::info;
use warp::Filter;

mod server;
mod simulation;
mod types;

use crate::server::routes;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt().init();

    // Load environment variables
    dotenvy::dotenv().ok();

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse::<u16>()
        .expect("PORT must be a valid port number");

    info!("Starting retirement simulation service on port {}", port);

    // Build routes
    let routes = routes();

    // Detailed health endpoint (kept for backward compat / human use)
    let health = warp::path("health").and(warp::get()).map(|| {
        warp::reply::json(&serde_json::json!({
            "status": "healthy",
            "service": "retirement-simulation",
            "version": env!("CARGO_PKG_VERSION")
        }))
    });

    // Liveness/startup probe target — no I/O, returns 200 immediately
    let healthz = warp::path("healthz")
        .and(warp::get())
        .map(|| warp::reply::with_status("ok", warp::http::StatusCode::OK));

    let all_routes = healthz.or(health).or(routes);

    // Start server
    info!(
        "Retirement simulation service running on http://0.0.0.0:{}",
        port
    );

    warp::serve(all_routes).run(([0, 0, 0, 0], port)).await;

    Ok(())
}
