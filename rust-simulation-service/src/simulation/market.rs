// Market data and return generation
use rand::Rng;
use rand_distr::{Distribution, Normal};

/// Historical market return constants
#[allow(dead_code)]
pub const STOCK_MEAN_RETURN: f64 = 0.071; // 7.1% real return
#[allow(dead_code)]
pub const STOCK_VOLATILITY: f64 = 0.201;  // 20.1% volatility
#[allow(dead_code)]
pub const BOND_MEAN_RETURN: f64 = 0.025;  // 2.5% real return
#[allow(dead_code)]
pub const BOND_VOLATILITY: f64 = 0.079;   // 7.9% volatility
#[allow(dead_code)]
pub const STOCK_BOND_CORRELATION: f64 = 0.12; // Low positive correlation

/// Generate correlated stock and bond returns
#[allow(dead_code)]
pub fn generate_correlated_returns<R: Rng>(
    rng: &mut R,
) -> Result<(f64, f64), Box<dyn std::error::Error>> {
    // Independent normal random variables
    let z1: f64 = Normal::new(0.0, 1.0)?.sample(rng);
    let z2: f64 = Normal::new(0.0, 1.0)?.sample(rng);
    
    // Apply correlation using Cholesky decomposition
    let stock_shock = z1;
    let bond_shock = STOCK_BOND_CORRELATION * z1 + 
        (1.0 - STOCK_BOND_CORRELATION * STOCK_BOND_CORRELATION).sqrt() * z2;
    
    // Generate returns
    let stock_return = STOCK_MEAN_RETURN + STOCK_VOLATILITY * stock_shock;
    let bond_return = BOND_MEAN_RETURN + BOND_VOLATILITY * bond_shock;
    
    Ok((stock_return, bond_return))
}