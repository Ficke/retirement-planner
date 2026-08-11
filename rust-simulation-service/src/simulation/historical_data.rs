// GENERATED FILE — do not edit by hand.
// Source of truth: apps/web/src/data/market-history-annual.ts
// Regenerate with: node scripts/gen-rust-historical-data.mjs
//
// Historical US market returns, 1928-2024 (97 years).
// Stocks: S&P 500 total return; Bonds: 10-year US Treasury total return
// (Damodaran data library, NYU Stern). Inflation: CPI-U Dec/Dec (BLS).
// Returns are NOMINAL; sampling converts to real returns per-year.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnualMarketReturn {
    pub year: u32,
    pub stock_return: f64,
    pub bond_return: f64,
    pub inflation_rate: f64,
}

pub const HISTORICAL_RETURNS: &[AnnualMarketReturn] = &[
    AnnualMarketReturn {
        year: 1928,
        stock_return: 0.4381,
        bond_return: 0.0084,
        inflation_rate: -0.012,
    },
    AnnualMarketReturn {
        year: 1929,
        stock_return: -0.083,
        bond_return: 0.042,
        inflation_rate: 0.006,
    },
    AnnualMarketReturn {
        year: 1930,
        stock_return: -0.2512,
        bond_return: 0.0454,
        inflation_rate: -0.064,
    },
    AnnualMarketReturn {
        year: 1931,
        stock_return: -0.4384,
        bond_return: -0.0256,
        inflation_rate: -0.093,
    },
    AnnualMarketReturn {
        year: 1932,
        stock_return: -0.0864,
        bond_return: 0.0879,
        inflation_rate: -0.103,
    },
    AnnualMarketReturn {
        year: 1933,
        stock_return: 0.4998,
        bond_return: 0.0186,
        inflation_rate: 0.008,
    },
    AnnualMarketReturn {
        year: 1934,
        stock_return: -0.0119,
        bond_return: 0.0796,
        inflation_rate: 0.015,
    },
    AnnualMarketReturn {
        year: 1935,
        stock_return: 0.4674,
        bond_return: 0.0447,
        inflation_rate: 0.03,
    },
    AnnualMarketReturn {
        year: 1936,
        stock_return: 0.3194,
        bond_return: 0.0502,
        inflation_rate: 0.014,
    },
    AnnualMarketReturn {
        year: 1937,
        stock_return: -0.3534,
        bond_return: 0.0138,
        inflation_rate: 0.029,
    },
    AnnualMarketReturn {
        year: 1938,
        stock_return: 0.2928,
        bond_return: 0.0421,
        inflation_rate: -0.028,
    },
    AnnualMarketReturn {
        year: 1939,
        stock_return: -0.011,
        bond_return: 0.0441,
        inflation_rate: 0.0,
    },
    AnnualMarketReturn {
        year: 1940,
        stock_return: -0.1067,
        bond_return: 0.054,
        inflation_rate: 0.007,
    },
    AnnualMarketReturn {
        year: 1941,
        stock_return: -0.1277,
        bond_return: -0.0202,
        inflation_rate: 0.099,
    },
    AnnualMarketReturn {
        year: 1942,
        stock_return: 0.1917,
        bond_return: 0.0229,
        inflation_rate: 0.09,
    },
    AnnualMarketReturn {
        year: 1943,
        stock_return: 0.2506,
        bond_return: 0.0249,
        inflation_rate: 0.03,
    },
    AnnualMarketReturn {
        year: 1944,
        stock_return: 0.1903,
        bond_return: 0.0258,
        inflation_rate: 0.023,
    },
    AnnualMarketReturn {
        year: 1945,
        stock_return: 0.3582,
        bond_return: 0.038,
        inflation_rate: 0.022,
    },
    AnnualMarketReturn {
        year: 1946,
        stock_return: -0.0843,
        bond_return: 0.0313,
        inflation_rate: 0.181,
    },
    AnnualMarketReturn {
        year: 1947,
        stock_return: 0.052,
        bond_return: 0.0092,
        inflation_rate: 0.088,
    },
    AnnualMarketReturn {
        year: 1948,
        stock_return: 0.057,
        bond_return: 0.0195,
        inflation_rate: 0.03,
    },
    AnnualMarketReturn {
        year: 1949,
        stock_return: 0.183,
        bond_return: 0.0466,
        inflation_rate: -0.021,
    },
    AnnualMarketReturn {
        year: 1950,
        stock_return: 0.3081,
        bond_return: 0.0043,
        inflation_rate: 0.059,
    },
    AnnualMarketReturn {
        year: 1951,
        stock_return: 0.2368,
        bond_return: -0.003,
        inflation_rate: 0.06,
    },
    AnnualMarketReturn {
        year: 1952,
        stock_return: 0.1815,
        bond_return: 0.0227,
        inflation_rate: 0.008,
    },
    AnnualMarketReturn {
        year: 1953,
        stock_return: -0.0121,
        bond_return: 0.0414,
        inflation_rate: 0.007,
    },
    AnnualMarketReturn {
        year: 1954,
        stock_return: 0.5256,
        bond_return: 0.0329,
        inflation_rate: -0.007,
    },
    AnnualMarketReturn {
        year: 1955,
        stock_return: 0.326,
        bond_return: -0.0134,
        inflation_rate: 0.004,
    },
    AnnualMarketReturn {
        year: 1956,
        stock_return: 0.0744,
        bond_return: -0.0226,
        inflation_rate: 0.03,
    },
    AnnualMarketReturn {
        year: 1957,
        stock_return: -0.1046,
        bond_return: 0.068,
        inflation_rate: 0.029,
    },
    AnnualMarketReturn {
        year: 1958,
        stock_return: 0.4372,
        bond_return: -0.021,
        inflation_rate: 0.018,
    },
    AnnualMarketReturn {
        year: 1959,
        stock_return: 0.1206,
        bond_return: -0.0265,
        inflation_rate: 0.017,
    },
    AnnualMarketReturn {
        year: 1960,
        stock_return: 0.0034,
        bond_return: 0.1164,
        inflation_rate: 0.014,
    },
    AnnualMarketReturn {
        year: 1961,
        stock_return: 0.2664,
        bond_return: 0.0206,
        inflation_rate: 0.007,
    },
    AnnualMarketReturn {
        year: 1962,
        stock_return: -0.0881,
        bond_return: 0.0569,
        inflation_rate: 0.013,
    },
    AnnualMarketReturn {
        year: 1963,
        stock_return: 0.2261,
        bond_return: 0.0168,
        inflation_rate: 0.016,
    },
    AnnualMarketReturn {
        year: 1964,
        stock_return: 0.1642,
        bond_return: 0.0373,
        inflation_rate: 0.01,
    },
    AnnualMarketReturn {
        year: 1965,
        stock_return: 0.124,
        bond_return: 0.0072,
        inflation_rate: 0.019,
    },
    AnnualMarketReturn {
        year: 1966,
        stock_return: -0.0997,
        bond_return: 0.0291,
        inflation_rate: 0.035,
    },
    AnnualMarketReturn {
        year: 1967,
        stock_return: 0.238,
        bond_return: -0.0158,
        inflation_rate: 0.03,
    },
    AnnualMarketReturn {
        year: 1968,
        stock_return: 0.1081,
        bond_return: 0.0327,
        inflation_rate: 0.047,
    },
    AnnualMarketReturn {
        year: 1969,
        stock_return: -0.0824,
        bond_return: -0.0501,
        inflation_rate: 0.062,
    },
    AnnualMarketReturn {
        year: 1970,
        stock_return: 0.0356,
        bond_return: 0.1675,
        inflation_rate: 0.056,
    },
    AnnualMarketReturn {
        year: 1971,
        stock_return: 0.1422,
        bond_return: 0.0979,
        inflation_rate: 0.033,
    },
    AnnualMarketReturn {
        year: 1972,
        stock_return: 0.1876,
        bond_return: 0.0282,
        inflation_rate: 0.034,
    },
    AnnualMarketReturn {
        year: 1973,
        stock_return: -0.1431,
        bond_return: 0.0366,
        inflation_rate: 0.087,
    },
    AnnualMarketReturn {
        year: 1974,
        stock_return: -0.259,
        bond_return: 0.0199,
        inflation_rate: 0.123,
    },
    AnnualMarketReturn {
        year: 1975,
        stock_return: 0.37,
        bond_return: 0.0361,
        inflation_rate: 0.069,
    },
    AnnualMarketReturn {
        year: 1976,
        stock_return: 0.2383,
        bond_return: 0.1598,
        inflation_rate: 0.049,
    },
    AnnualMarketReturn {
        year: 1977,
        stock_return: -0.0698,
        bond_return: 0.0129,
        inflation_rate: 0.067,
    },
    AnnualMarketReturn {
        year: 1978,
        stock_return: 0.0651,
        bond_return: -0.0078,
        inflation_rate: 0.09,
    },
    AnnualMarketReturn {
        year: 1979,
        stock_return: 0.1852,
        bond_return: 0.0067,
        inflation_rate: 0.133,
    },
    AnnualMarketReturn {
        year: 1980,
        stock_return: 0.3174,
        bond_return: -0.0299,
        inflation_rate: 0.125,
    },
    AnnualMarketReturn {
        year: 1981,
        stock_return: -0.047,
        bond_return: 0.082,
        inflation_rate: 0.089,
    },
    AnnualMarketReturn {
        year: 1982,
        stock_return: 0.2042,
        bond_return: 0.3281,
        inflation_rate: 0.038,
    },
    AnnualMarketReturn {
        year: 1983,
        stock_return: 0.2234,
        bond_return: 0.032,
        inflation_rate: 0.038,
    },
    AnnualMarketReturn {
        year: 1984,
        stock_return: 0.0615,
        bond_return: 0.1373,
        inflation_rate: 0.039,
    },
    AnnualMarketReturn {
        year: 1985,
        stock_return: 0.3124,
        bond_return: 0.2571,
        inflation_rate: 0.038,
    },
    AnnualMarketReturn {
        year: 1986,
        stock_return: 0.1849,
        bond_return: 0.2428,
        inflation_rate: 0.011,
    },
    AnnualMarketReturn {
        year: 1987,
        stock_return: 0.0581,
        bond_return: -0.0496,
        inflation_rate: 0.044,
    },
    AnnualMarketReturn {
        year: 1988,
        stock_return: 0.1654,
        bond_return: 0.0822,
        inflation_rate: 0.044,
    },
    AnnualMarketReturn {
        year: 1989,
        stock_return: 0.3148,
        bond_return: 0.1769,
        inflation_rate: 0.046,
    },
    AnnualMarketReturn {
        year: 1990,
        stock_return: -0.0306,
        bond_return: 0.0624,
        inflation_rate: 0.061,
    },
    AnnualMarketReturn {
        year: 1991,
        stock_return: 0.3023,
        bond_return: 0.15,
        inflation_rate: 0.031,
    },
    AnnualMarketReturn {
        year: 1992,
        stock_return: 0.0749,
        bond_return: 0.0936,
        inflation_rate: 0.029,
    },
    AnnualMarketReturn {
        year: 1993,
        stock_return: 0.0997,
        bond_return: 0.1421,
        inflation_rate: 0.027,
    },
    AnnualMarketReturn {
        year: 1994,
        stock_return: 0.0133,
        bond_return: -0.0804,
        inflation_rate: 0.027,
    },
    AnnualMarketReturn {
        year: 1995,
        stock_return: 0.372,
        bond_return: 0.2348,
        inflation_rate: 0.025,
    },
    AnnualMarketReturn {
        year: 1996,
        stock_return: 0.2268,
        bond_return: 0.0143,
        inflation_rate: 0.033,
    },
    AnnualMarketReturn {
        year: 1997,
        stock_return: 0.331,
        bond_return: 0.0994,
        inflation_rate: 0.017,
    },
    AnnualMarketReturn {
        year: 1998,
        stock_return: 0.2834,
        bond_return: 0.1492,
        inflation_rate: 0.016,
    },
    AnnualMarketReturn {
        year: 1999,
        stock_return: 0.2089,
        bond_return: -0.0825,
        inflation_rate: 0.027,
    },
    AnnualMarketReturn {
        year: 2000,
        stock_return: -0.0903,
        bond_return: 0.1666,
        inflation_rate: 0.034,
    },
    AnnualMarketReturn {
        year: 2001,
        stock_return: -0.1185,
        bond_return: 0.0557,
        inflation_rate: 0.016,
    },
    AnnualMarketReturn {
        year: 2002,
        stock_return: -0.2197,
        bond_return: 0.1512,
        inflation_rate: 0.024,
    },
    AnnualMarketReturn {
        year: 2003,
        stock_return: 0.2836,
        bond_return: 0.0038,
        inflation_rate: 0.019,
    },
    AnnualMarketReturn {
        year: 2004,
        stock_return: 0.1074,
        bond_return: 0.0449,
        inflation_rate: 0.033,
    },
    AnnualMarketReturn {
        year: 2005,
        stock_return: 0.0483,
        bond_return: 0.0287,
        inflation_rate: 0.034,
    },
    AnnualMarketReturn {
        year: 2006,
        stock_return: 0.1561,
        bond_return: 0.0196,
        inflation_rate: 0.025,
    },
    AnnualMarketReturn {
        year: 2007,
        stock_return: 0.0548,
        bond_return: 0.1021,
        inflation_rate: 0.041,
    },
    AnnualMarketReturn {
        year: 2008,
        stock_return: -0.3655,
        bond_return: 0.201,
        inflation_rate: 0.001,
    },
    AnnualMarketReturn {
        year: 2009,
        stock_return: 0.2594,
        bond_return: -0.1112,
        inflation_rate: 0.027,
    },
    AnnualMarketReturn {
        year: 2010,
        stock_return: 0.1482,
        bond_return: 0.0846,
        inflation_rate: 0.015,
    },
    AnnualMarketReturn {
        year: 2011,
        stock_return: 0.021,
        bond_return: 0.1604,
        inflation_rate: 0.03,
    },
    AnnualMarketReturn {
        year: 2012,
        stock_return: 0.1589,
        bond_return: 0.0297,
        inflation_rate: 0.017,
    },
    AnnualMarketReturn {
        year: 2013,
        stock_return: 0.3215,
        bond_return: -0.091,
        inflation_rate: 0.015,
    },
    AnnualMarketReturn {
        year: 2014,
        stock_return: 0.1352,
        bond_return: 0.1075,
        inflation_rate: 0.008,
    },
    AnnualMarketReturn {
        year: 2015,
        stock_return: 0.0138,
        bond_return: 0.0128,
        inflation_rate: 0.007,
    },
    AnnualMarketReturn {
        year: 2016,
        stock_return: 0.1177,
        bond_return: 0.0069,
        inflation_rate: 0.021,
    },
    AnnualMarketReturn {
        year: 2017,
        stock_return: 0.2161,
        bond_return: 0.028,
        inflation_rate: 0.021,
    },
    AnnualMarketReturn {
        year: 2018,
        stock_return: -0.0423,
        bond_return: -0.0002,
        inflation_rate: 0.019,
    },
    AnnualMarketReturn {
        year: 2019,
        stock_return: 0.3121,
        bond_return: 0.0964,
        inflation_rate: 0.023,
    },
    AnnualMarketReturn {
        year: 2020,
        stock_return: 0.1802,
        bond_return: 0.1133,
        inflation_rate: 0.014,
    },
    AnnualMarketReturn {
        year: 2021,
        stock_return: 0.2847,
        bond_return: -0.0442,
        inflation_rate: 0.07,
    },
    AnnualMarketReturn {
        year: 2022,
        stock_return: -0.1804,
        bond_return: -0.1783,
        inflation_rate: 0.065,
    },
    AnnualMarketReturn {
        year: 2023,
        stock_return: 0.2606,
        bond_return: 0.0388,
        inflation_rate: 0.034,
    },
    AnnualMarketReturn {
        year: 2024,
        stock_return: 0.2488,
        bond_return: -0.0164,
        inflation_rate: 0.029,
    },
];

/// Get a random historical year's returns using bootstrap sampling.
/// Returns real returns: real = (1 + nominal) / (1 + inflation) - 1
pub fn sample_historical_returns<R: rand::Rng>(rng: &mut R) -> (f64, f64) {
    let random_year = &HISTORICAL_RETURNS[rng.gen_range(0..HISTORICAL_RETURNS.len())];

    let real_stock_return =
        (1.0 + random_year.stock_return) / (1.0 + random_year.inflation_rate) - 1.0;
    let real_bond_return =
        (1.0 + random_year.bond_return) / (1.0 + random_year.inflation_rate) - 1.0;

    (real_stock_return, real_bond_return)
}

/// Sample a block of consecutive years for block bootstrap.
/// Returns real returns (adjusted for inflation).
pub fn sample_block<R: rand::Rng>(rng: &mut R, block_size: usize) -> Vec<(f64, f64)> {
    let start_index = rng.gen_range(0..HISTORICAL_RETURNS.len());
    let block_size = block_size.min(HISTORICAL_RETURNS.len());

    (0..block_size)
        .map(|offset| &HISTORICAL_RETURNS[(start_index + offset) % HISTORICAL_RETURNS.len()])
        .map(|year_data| {
            let real_stock_return =
                (1.0 + year_data.stock_return) / (1.0 + year_data.inflation_rate) - 1.0;
            let real_bond_return =
                (1.0 + year_data.bond_return) / (1.0 + year_data.inflation_rate) - 1.0;
            (real_stock_return, real_bond_return)
        })
        .collect()
}
