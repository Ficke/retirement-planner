//! Parametric return generation.
//!
//! All statistics are DERIVED from the canonical historical dataset in
//! `historical_data.rs` (itself generated from the TS source of truth), so the
//! parametric model in both engines is fit to the same real-return history.
//! Sampling matches the TS implementation: log-space, Student-t (df=6) equity
//! shocks, Normal bond shocks, Cholesky-correlated.

use anyhow::Result;
use rand::Rng;
use rand_distr::{Distribution, Normal, StudentT};
use std::sync::LazyLock;

use super::historical_data::HISTORICAL_RETURNS;

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

struct DerivedStats {
    // stock/bond arithmetic stats are only read by tests; the generator
    // consumes the log-space parameters derived from them.
    #[cfg_attr(not(test), allow(dead_code))]
    stock: MarketStats,
    #[cfg_attr(not(test), allow(dead_code))]
    bond: MarketStats,
    correlation: f64,
    stock_log: (f64, f64), // (mu_log, sigma_log)
    bond_log: (f64, f64),
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len() as f64
}

fn std_dev(xs: &[f64]) -> f64 {
    let m = mean(xs);
    (xs.iter().map(|v| (v - m).powi(2)).sum::<f64>() / xs.len() as f64).sqrt()
}

/// Convert arithmetic mean/vol to log-space parameters so that
///   exp(mu_log + sigma_log * Z) - 1
/// has the given arithmetic mean and volatility for Z ~ N(0, 1).
fn to_log_params(stats: MarketStats) -> (f64, f64) {
    let sigma_log = (1.0 + (stats.volatility / (1.0 + stats.mean)).powi(2))
        .ln()
        .sqrt();
    let mu_log = (1.0 + stats.mean).ln() - 0.5 * sigma_log * sigma_log;
    (mu_log, sigma_log)
}

static STATS: LazyLock<DerivedStats> = LazyLock::new(|| {
    let real_stock: Vec<f64> = HISTORICAL_RETURNS
        .iter()
        .map(|r| (1.0 + r.stock_return) / (1.0 + r.inflation_rate) - 1.0)
        .collect();
    let real_bond: Vec<f64> = HISTORICAL_RETURNS
        .iter()
        .map(|r| (1.0 + r.bond_return) / (1.0 + r.inflation_rate) - 1.0)
        .collect();

    let stock = MarketStats {
        mean: mean(&real_stock),
        volatility: std_dev(&real_stock),
    };
    let bond = MarketStats {
        mean: mean(&real_bond),
        volatility: std_dev(&real_bond),
    };

    let cov = real_stock
        .iter()
        .zip(&real_bond)
        .map(|(s, b)| (s - stock.mean) * (b - bond.mean))
        .sum::<f64>()
        / real_stock.len() as f64;
    let correlation = cov / (stock.volatility * bond.volatility);

    DerivedStats {
        stock,
        bond,
        correlation,
        stock_log: to_log_params(stock),
        bond_log: to_log_params(bond),
    }
});

/// Generate correlated annual real returns for stocks and bonds.
/// See module docs; matches the TS implementation in aggregate distribution.
pub fn generate_parametric_returns<R: Rng>(rng: &mut R) -> Result<MarketReturns> {
    let student_t = StudentT::new(6.0)?;
    let normal = Normal::new(0.0, 1.0)?;

    let degrees_of_freedom: f64 = 6.0;
    let stock_shock =
        student_t.sample(rng) / (degrees_of_freedom / (degrees_of_freedom - 2.0)).sqrt();
    let bond_shock = normal.sample(rng);

    // Cholesky for [[1, r], [r, 1]]: L = [[1, 0], [r, sqrt(1 - r^2)]]
    let r = STATS.correlation;
    let correlated_stock = stock_shock;
    let correlated_bond = r * stock_shock + (1.0 - r * r).sqrt() * bond_shock;

    let (stock_mu, stock_sigma) = STATS.stock_log;
    let (bond_mu, bond_sigma) = STATS.bond_log;

    Ok(MarketReturns {
        stock_return: (stock_mu + correlated_stock * stock_sigma).exp() - 1.0,
        bond_return: (bond_mu + correlated_bond * bond_sigma).exp() - 1.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn derived_stats_are_sane() {
        let s = STATS.stock;
        let b = STATS.bond;
        // Real US stock/bond history: broad sanity bands, not exact pins,
        // so dataset updates don't break the test.
        assert!(s.mean > 0.05 && s.mean < 0.12, "stock mean {}", s.mean);
        assert!(
            s.volatility > 0.15 && s.volatility < 0.25,
            "stock vol {}",
            s.volatility
        );
        assert!(b.mean > -0.01 && b.mean < 0.05, "bond mean {}", b.mean);
        assert!(
            b.volatility > 0.05 && b.volatility < 0.12,
            "bond vol {}",
            b.volatility
        );
    }

    #[test]
    fn parametric_returns_match_derived_moments() {
        let mut rng = StdRng::seed_from_u64(42);

        let mut stock_returns = Vec::new();
        let mut bond_returns = Vec::new();
        for _ in 0..20000 {
            let returns = generate_parametric_returns(&mut rng).unwrap();
            stock_returns.push(returns.stock_return);
            bond_returns.push(returns.bond_return);
        }

        // Bounded below by -1 by construction
        assert!(stock_returns.iter().all(|&r| r > -1.0));
        assert!(bond_returns.iter().all(|&r| r > -1.0));

        let stock_mean = mean(&stock_returns);
        let bond_mean = mean(&bond_returns);
        assert!((stock_mean - STATS.stock.mean).abs() < 0.02);
        assert!((bond_mean - STATS.bond.mean).abs() < 0.01);
    }
}
