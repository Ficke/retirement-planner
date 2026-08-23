use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::simulation::monte_carlo::{count_sweep_shard_sequential, run_simulation_sequential};
use crate::types::{BatchSimulationRequest, SimulationRequest, WASM_ABI_VERSION};
use crate::validation::{validate_batch_simulations, validate_simulation_request};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SweepShardRequest {
    simulations: Vec<BatchSimulationRequest>,
    start_path: u32,
    end_path: u32,
}

#[derive(Serialize)]
struct SweepShardResponse {
    id: String,
    #[serde(rename = "successCount")]
    success_count: u32,
}

fn deserialize<T>(value: JsValue) -> Result<T, JsError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsError::new(&format!("Invalid simulation request: {error}")))
}

fn serialize<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsError::new(&format!("Could not serialize simulation result: {error}")))
}

#[wasm_bindgen]
pub fn run_simulation(request: JsValue) -> Result<JsValue, JsError> {
    let request: SimulationRequest = deserialize(request)?;
    validate_simulation_request(&request).map_err(|error| JsError::new(&error))?;
    let result = run_simulation_sequential(request.plan, request.config)
        .map_err(|error| JsError::new(&error.to_string()))?;
    serialize(&result)
}

#[wasm_bindgen]
pub fn run_sweep_shard(request: JsValue) -> Result<JsValue, JsError> {
    let request: SweepShardRequest = deserialize(request)?;
    validate_batch_simulations(&request.simulations).map_err(|error| JsError::new(&error))?;
    let counts =
        count_sweep_shard_sequential(&request.simulations, request.start_path, request.end_path)
            .map_err(|error| JsError::new(&error.to_string()))?;
    let response: Vec<SweepShardResponse> = request
        .simulations
        .into_iter()
        .zip(counts)
        .map(|(simulation, success_count)| SweepShardResponse {
            id: simulation.id,
            success_count,
        })
        .collect();
    serialize(&response)
}

#[wasm_bindgen]
pub fn wasm_abi_version() -> u32 {
    WASM_ABI_VERSION
}

#[wasm_bindgen]
pub fn engine_version() -> String {
    format!("{}:chacha12-v1", env!("CARGO_PKG_VERSION"))
}
