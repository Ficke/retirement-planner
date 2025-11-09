use rand::Rng;
use rand_distr::{Distribution, Normal, StudentT};
use anyhow::Result;

/// Market statistics matching TypeScript implementation
/// Historical US Stock Market Real Returns (1926-2024)
/// Source: S&P 500 total return index, inflation-adjusted
pub const US_STOCK_REAL_RETURNS: MarketStats = MarketStats {
    mean: 0.071,      // 7.1% real return
    volatility: 0.201, // 20.1% standard deviation
};

/// Historical US Bond Real Returns (1926-2024)  
/// Source: Long-term government bonds, inflation-adjusted
pub const US_BOND_REAL_RETURNS: MarketStats = MarketStats {
    mean: 0.025,     // 2.5% real return
    volatility: 0.079, // 7.9% standard deviation
};

/// Stock-Bond Correlation (1926-2024)
pub const STOCKS_BONDS_CORRELATION: f64 = 0.12; // Low positive correlation historically

/// Return bounds to prevent unrealistic values
/// Historical worst year was -42.81% for stocks, -15.84% for bonds
/// Allow 50% buffer for extreme cases
pub const MAX_STOCK_RETURN: f64 = 0.80;  // 80% max gain
pub const MIN_STOCK_RETURN: f64 = -0.60; // -60% max loss
pub const MAX_BOND_RETURN: f64 = 0.50;   // 50% max gain
pub const MIN_BOND_RETURN: f64 = -0.25;  // -25% max loss

#[derive(Debug, Clone, Copy)]
pub struct MarketStats {
    pub mean: f64,
    pub volatility: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct MarketReturns {
    pub stock_return: f64,
    pub bond_return: f64,
}

/// Generate correlated annual returns for stocks and bonds using parametric approach.
/// Matches TypeScript implementation exactly:
/// - Student's t-distribution with 6 degrees of freedom for equities
/// - Normal distribution for bonds  
/// - Cholesky decomposition for proper correlation structure
/// - Return bounds to prevent unrealistic values
pub fn generate_parametric_returns<R: Rng>(rng: &mut R) -> Result<MarketReturns> {
    // Generate independent shocks using proper distributions
    let student_t = StudentT::new(6.0)?; // Student-t with df=6 for equities
    let normal = Normal::new(0.0, 1.0)?; // Standard normal for bonds
    
    let stock_shock = student_t.sample(rng);
    let bond_shock = normal.sample(rng);
    
    // Apply Cholesky transformation for correlation
    // Correlation matrix: [[1.0, r], [r, 1.0]] where r = STOCKS_BONDS_CORRELATION
    let cholesky = cholesky_decomposition_2x2(STOCKS_BONDS_CORRELATION);
    
    let correlated_shocks = [
        cholesky[0][0] * stock_shock,
        cholesky[1][0] * stock_shock + cholesky[1][1] * bond_shock,
    ];
    
    // Apply mean and volatility
    let stock_return = US_STOCK_REAL_RETURNS.mean + 
        correlated_shocks[0] * US_STOCK_REAL_RETURNS.volatility;
    let bond_return = US_BOND_REAL_RETURNS.mean + 
        correlated_shocks[1] * US_BOND_REAL_RETURNS.volatility;
    
    // Bound returns to prevent unrealistic values
    let bounded_stock_return = stock_return.clamp(MIN_STOCK_RETURN, MAX_STOCK_RETURN);
    let bounded_bond_return = bond_return.clamp(MIN_BOND_RETURN, MAX_BOND_RETURN);
    
    // Warn if bounds were applied (indicates potential issue)
    if (bounded_stock_return - stock_return).abs() > f64::EPSILON ||
       (bounded_bond_return - bond_return).abs() > f64::EPSILON {
        tracing::warn!(
            "Return bounds applied: stock {} -> {}, bond {} -> {}",
            stock_return, bounded_stock_return, bond_return, bounded_bond_return
        );
    }
    
    Ok(MarketReturns {
        stock_return: bounded_stock_return,
        bond_return: bounded_bond_return,
    })
}

/// Optimized Cholesky decomposition for 2x2 correlation matrix.
/// For correlation matrix [[1, r], [r, 1]], returns lower triangular matrix L
/// such that L * L^T = correlation matrix.
fn cholesky_decomposition_2x2(correlation: f64) -> [[f64; 2]; 2] {
    // For 2x2 correlation matrix [[1, r], [r, 1]]:
    // L = [[1, 0], [r, sqrt(1-r²)]]
    let r = correlation;
    let sqrt_term = (1.0 - r * r).sqrt();
    
    [
        [1.0, 0.0],
        [r, sqrt_term],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    #[test]
    fn test_cholesky_decomposition_2x2() {
        let r = 0.12;
        let l = cholesky_decomposition_2x2(r);
        
        // Verify L * L^T = original correlation matrix
        let reconstructed = [
            [l[0][0] * l[0][0] + l[0][1] * l[0][1], l[0][0] * l[1][0] + l[0][1] * l[1][1]],
            [l[1][0] * l[0][0] + l[1][1] * l[0][1], l[1][0] * l[1][0] + l[1][1] * l[1][1]],
        ];
        
        assert!((reconstructed[0][0] - 1.0).abs() < 1e-10);
        assert!((reconstructed[1][1] - 1.0).abs() < 1e-10);
        assert!((reconstructed[0][1] - r).abs() < 1e-10);
        assert!((reconstructed[1][0] - r).abs() < 1e-10);
    }

    #[test]
    fn test_parametric_returns_generation() {
        let mut rng = StdRng::seed_from_u64(42);
        
        // Generate many samples to test distribution properties
        let mut stock_returns = Vec::new();
        let mut bond_returns = Vec::new();
        
        for _ in 0..1000 {
            let returns = generate_parametric_returns(&mut rng).unwrap();
            stock_returns.push(returns.stock_return);
            bond_returns.push(returns.bond_return);
        }
        
        // Check that returns are within bounds
        for &ret in &stock_returns {
            assert!(ret >= MIN_STOCK_RETURN && ret <= MAX_STOCK_RETURN);
        }
        for &ret in &bond_returns {
            assert!(ret >= MIN_BOND_RETURN && ret <= MAX_BOND_RETURN);
        }
        
        // Check approximate means (should be close to target with large sample)
        let stock_mean = stock_returns.iter().sum::<f64>() / stock_returns.len() as f64;
        let bond_mean = bond_returns.iter().sum::<f64>() / bond_returns.len() as f64;
        
        // Allow 5% tolerance for mean estimates
        assert!((stock_mean - US_STOCK_REAL_RETURNS.mean).abs() < 0.05);
        assert!((bond_mean - US_BOND_REAL_RETURNS.mean).abs() < 0.05);
    }
}