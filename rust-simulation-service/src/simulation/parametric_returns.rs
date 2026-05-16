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

/// Convert documented arithmetic mean/vol to log-space parameters so that
///   exp(mu_log + sigma_log * Z) - 1
/// has the documented arithmetic mean and volatility for Z ~ N(0, 1).
fn to_log_params(stats: MarketStats) -> (f64, f64) {
    let sigma_log = (1.0 + (stats.volatility / (1.0 + stats.mean)).powi(2)).ln().sqrt();
    let mu_log = (1.0 + stats.mean).ln() - 0.5 * sigma_log * sigma_log;
    (mu_log, sigma_log)
}

/// Generate correlated annual real returns for stocks and bonds.
///
/// Sampling is done in log-return space: equities use Student-t (df=6) shocks
/// for fat tails, bonds use Normal shocks, and Cholesky preserves the documented
/// stock/bond correlation. The final simple return is
///   R = exp(mu_log + sigma_log * Z) - 1
/// which is bounded below by -1 (total loss) by construction. No artificial
/// upper/lower clamps are applied — the chosen distributions own tail shape.
pub fn generate_parametric_returns<R: Rng>(rng: &mut R) -> Result<MarketReturns> {
    let student_t = StudentT::new(6.0)?;
    let normal = Normal::new(0.0, 1.0)?;

    let stock_shock = student_t.sample(rng);
    let bond_shock = normal.sample(rng);

    // Cholesky for [[1, r], [r, 1]] correlation structure.
    let cholesky = cholesky_decomposition_2x2(STOCKS_BONDS_CORRELATION);
    let correlated_shocks = [
        cholesky[0][0] * stock_shock,
        cholesky[1][0] * stock_shock + cholesky[1][1] * bond_shock,
    ];

    let (stock_mu_log, stock_sigma_log) = to_log_params(US_STOCK_REAL_RETURNS);
    let (bond_mu_log, bond_sigma_log) = to_log_params(US_BOND_REAL_RETURNS);

    Ok(MarketReturns {
        stock_return: (stock_mu_log + correlated_shocks[0] * stock_sigma_log).exp() - 1.0,
        bond_return: (bond_mu_log + correlated_shocks[1] * bond_sigma_log).exp() - 1.0,
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
        
        // Log-space sampling: returns are bounded below by -1 by construction
        // (total loss). No artificial upper bound — the distribution decides.
        for &ret in &stock_returns {
            assert!(ret > -1.0);
        }
        for &ret in &bond_returns {
            assert!(ret > -1.0);
        }

        // Check approximate means (should be close to target with large sample)
        let stock_mean = stock_returns.iter().sum::<f64>() / stock_returns.len() as f64;
        let bond_mean = bond_returns.iter().sum::<f64>() / bond_returns.len() as f64;
        
        // Allow 5% tolerance for mean estimates
        assert!((stock_mean - US_STOCK_REAL_RETURNS.mean).abs() < 0.05);
        assert!((bond_mean - US_BOND_REAL_RETURNS.mean).abs() < 0.05);
    }
}