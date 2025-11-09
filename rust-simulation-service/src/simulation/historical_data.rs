/// Historical US Market Returns (1928-2023)
/// Source: SBBI Yearbook, Aswath Damodaran's data library, Robert Shiller data
/// 
/// This comprehensive data set represents nearly 100 years of US market history
/// including major economic events like the Great Depression, WWII, stagflation,
/// financial crises, and more.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnualMarketReturn {
    pub year: u32,
    pub stock_return: f64,   // Annual nominal return for stocks (S&P 500 total return)
    pub bond_return: f64,    // Annual nominal return for bonds (10-Year Treasury bonds)
    pub inflation_rate: f64, // Annual CPI inflation rate
}

/// Historical market returns from 1928-2023 (96 years of data)
/// Returns are NOMINAL as provided by historical sources
pub const HISTORICAL_RETURNS: &[AnnualMarketReturn] = &[
    // Pre-Depression and Great Depression Era (1928-1939)
    AnnualMarketReturn { year: 1928, stock_return: 0.4381, bond_return: 0.0084, inflation_rate: -0.0116 },
    AnnualMarketReturn { year: 1929, stock_return: -0.0830, bond_return: 0.0420, inflation_rate: 0.0000 },
    AnnualMarketReturn { year: 1930, stock_return: -0.2512, bond_return: 0.0454, inflation_rate: -0.0234 },
    AnnualMarketReturn { year: 1931, stock_return: -0.4384, bond_return: -0.0256, inflation_rate: -0.0880 },
    AnnualMarketReturn { year: 1932, stock_return: -0.0864, bond_return: 0.0879, inflation_rate: -0.1028 },
    AnnualMarketReturn { year: 1933, stock_return: 0.5299, bond_return: 0.0356, inflation_rate: 0.0093 },
    AnnualMarketReturn { year: 1934, stock_return: -0.0142, bond_return: 0.0782, inflation_rate: 0.0315 },
    AnnualMarketReturn { year: 1935, stock_return: 0.4674, bond_return: 0.0449, inflation_rate: 0.0253 },
    AnnualMarketReturn { year: 1936, stock_return: 0.3194, bond_return: 0.0514, inflation_rate: 0.0100 },
    AnnualMarketReturn { year: 1937, stock_return: -0.3534, bond_return: 0.0124, inflation_rate: 0.0370 },
    AnnualMarketReturn { year: 1938, stock_return: 0.2928, bond_return: 0.0429, inflation_rate: -0.0189 },
    AnnualMarketReturn { year: 1939, stock_return: -0.0110, bond_return: 0.0401, inflation_rate: -0.0134 },

    // World War II Era (1940-1949)
    AnnualMarketReturn { year: 1940, stock_return: -0.1067, bond_return: 0.0494, inflation_rate: 0.0076 },
    AnnualMarketReturn { year: 1941, stock_return: -0.1277, bond_return: -0.0229, inflation_rate: 0.0504 },
    AnnualMarketReturn { year: 1942, stock_return: 0.1917, bond_return: 0.0249, inflation_rate: 0.1091 },
    AnnualMarketReturn { year: 1943, stock_return: 0.2506, bond_return: 0.0188, inflation_rate: 0.0607 },
    AnnualMarketReturn { year: 1944, stock_return: 0.1903, bond_return: 0.0210, inflation_rate: 0.0173 },
    AnnualMarketReturn { year: 1945, stock_return: 0.3582, bond_return: 0.0336, inflation_rate: 0.0227 },
    AnnualMarketReturn { year: 1946, stock_return: -0.0843, bond_return: -0.0028, inflation_rate: 0.0833 },
    AnnualMarketReturn { year: 1947, stock_return: 0.0521, bond_return: -0.0051, inflation_rate: 0.1436 },
    AnnualMarketReturn { year: 1948, stock_return: 0.0570, bond_return: 0.0069, inflation_rate: 0.0772 },
    AnnualMarketReturn { year: 1949, stock_return: 0.1831, bond_return: 0.0384, inflation_rate: -0.0122 },

    // Post-war Boom (1950-1969)
    AnnualMarketReturn { year: 1950, stock_return: 0.3081, bond_return: 0.0113, inflation_rate: 0.0126 },
    AnnualMarketReturn { year: 1951, stock_return: 0.2368, bond_return: -0.0080, inflation_rate: 0.0789 },
    AnnualMarketReturn { year: 1952, stock_return: 0.1815, bond_return: 0.0142, inflation_rate: 0.0221 },
    AnnualMarketReturn { year: 1953, stock_return: -0.0121, bond_return: 0.0082, inflation_rate: 0.0079 },
    AnnualMarketReturn { year: 1954, stock_return: 0.5262, bond_return: 0.0371, inflation_rate: 0.0049 },
    AnnualMarketReturn { year: 1955, stock_return: 0.3256, bond_return: -0.0068, inflation_rate: -0.0034 },
    AnnualMarketReturn { year: 1956, stock_return: 0.0743, bond_return: -0.0305, inflation_rate: 0.0146 },
    AnnualMarketReturn { year: 1957, stock_return: -0.1047, bond_return: 0.0559, inflation_rate: 0.0336 },
    AnnualMarketReturn { year: 1958, stock_return: 0.4372, bond_return: -0.0024, inflation_rate: 0.0276 },
    AnnualMarketReturn { year: 1959, stock_return: 0.1196, bond_return: -0.0347, inflation_rate: 0.0084 },
    AnnualMarketReturn { year: 1960, stock_return: 0.0033, bond_return: 0.1009, inflation_rate: 0.0163 },
    AnnualMarketReturn { year: 1961, stock_return: 0.2664, bond_return: 0.0238, inflation_rate: 0.0104 },
    AnnualMarketReturn { year: 1962, stock_return: -0.0881, bond_return: 0.0532, inflation_rate: 0.0115 },
    AnnualMarketReturn { year: 1963, stock_return: 0.2261, bond_return: 0.0179, inflation_rate: 0.0123 },
    AnnualMarketReturn { year: 1964, stock_return: 0.1643, bond_return: 0.0289, inflation_rate: 0.0132 },
    AnnualMarketReturn { year: 1965, stock_return: 0.1241, bond_return: 0.0101, inflation_rate: 0.0169 },
    AnnualMarketReturn { year: 1966, stock_return: -0.1001, bond_return: 0.0289, inflation_rate: 0.0290 },
    AnnualMarketReturn { year: 1967, stock_return: 0.2380, bond_return: -0.0274, inflation_rate: 0.0288 },
    AnnualMarketReturn { year: 1968, stock_return: 0.1081, bond_return: 0.0210, inflation_rate: 0.0423 },
    AnnualMarketReturn { year: 1969, stock_return: -0.0850, bond_return: -0.0508, inflation_rate: 0.0546 },

    // Stagflation Era (1970-1979)
    AnnualMarketReturn { year: 1970, stock_return: 0.0401, bond_return: 0.1210, inflation_rate: 0.0574 },
    AnnualMarketReturn { year: 1971, stock_return: 0.1431, bond_return: 0.0901, inflation_rate: 0.0427 },
    AnnualMarketReturn { year: 1972, stock_return: 0.1898, bond_return: 0.0584, inflation_rate: 0.0327 },
    AnnualMarketReturn { year: 1973, stock_return: -0.1466, bond_return: -0.0111, inflation_rate: 0.0651 },
    AnnualMarketReturn { year: 1974, stock_return: -0.2647, bond_return: 0.0435, inflation_rate: 0.1108 },
    AnnualMarketReturn { year: 1975, stock_return: 0.3720, bond_return: 0.0919, inflation_rate: 0.0903 },
    AnnualMarketReturn { year: 1976, stock_return: 0.2384, bond_return: 0.1675, inflation_rate: 0.0578 },
    AnnualMarketReturn { year: 1977, stock_return: -0.0718, bond_return: -0.0067, inflation_rate: 0.0651 },
    AnnualMarketReturn { year: 1978, stock_return: 0.0656, bond_return: -0.0116, inflation_rate: 0.0761 },
    AnnualMarketReturn { year: 1979, stock_return: 0.1844, bond_return: -0.0122, inflation_rate: 0.1135 },

    // Volcker Era and Recovery (1980-1989)
    AnnualMarketReturn { year: 1980, stock_return: 0.3242, bond_return: -0.0395, inflation_rate: 0.1355 },
    AnnualMarketReturn { year: 1981, stock_return: -0.0491, bond_return: 0.0185, inflation_rate: 0.1025 },
    AnnualMarketReturn { year: 1982, stock_return: 0.2155, bond_return: 0.4035, inflation_rate: 0.0619 },
    AnnualMarketReturn { year: 1983, stock_return: 0.2251, bond_return: 0.0070, inflation_rate: 0.0323 },
    AnnualMarketReturn { year: 1984, stock_return: 0.0627, bond_return: 0.1543, inflation_rate: 0.0433 },
    AnnualMarketReturn { year: 1985, stock_return: 0.3161, bond_return: 0.2090, inflation_rate: 0.0359 },
    AnnualMarketReturn { year: 1986, stock_return: 0.1849, bond_return: 0.2444, inflation_rate: 0.0186 },
    AnnualMarketReturn { year: 1987, stock_return: 0.0523, bond_return: -0.0269, inflation_rate: 0.0368 },
    AnnualMarketReturn { year: 1988, stock_return: 0.1681, bond_return: 0.0967, inflation_rate: 0.0414 },
    AnnualMarketReturn { year: 1989, stock_return: 0.3169, bond_return: 0.1422, inflation_rate: 0.0474 },

    // Great Moderation (1990-2007)
    AnnualMarketReturn { year: 1990, stock_return: -0.0310, bond_return: 0.0618, inflation_rate: 0.0511 },
    AnnualMarketReturn { year: 1991, stock_return: 0.3047, bond_return: 0.1930, inflation_rate: 0.0423 },
    AnnualMarketReturn { year: 1992, stock_return: 0.0762, bond_return: 0.0879, inflation_rate: 0.0305 },
    AnnualMarketReturn { year: 1993, stock_return: 0.1008, bond_return: 0.1245, inflation_rate: 0.0296 },
    AnnualMarketReturn { year: 1994, stock_return: 0.0132, bond_return: -0.0775, inflation_rate: 0.0261 },
    AnnualMarketReturn { year: 1995, stock_return: 0.3758, bond_return: 0.2341, inflation_rate: 0.0283 },
    AnnualMarketReturn { year: 1996, stock_return: 0.2296, bond_return: 0.0070, inflation_rate: 0.0296 },
    AnnualMarketReturn { year: 1997, stock_return: 0.3336, bond_return: 0.1258, inflation_rate: 0.0233 },
    AnnualMarketReturn { year: 1998, stock_return: 0.2858, bond_return: 0.1745, inflation_rate: 0.0156 },
    AnnualMarketReturn { year: 1999, stock_return: 0.2104, bond_return: -0.0751, inflation_rate: 0.0220 },
    AnnualMarketReturn { year: 2000, stock_return: -0.0910, bond_return: 0.1660, inflation_rate: 0.0339 },
    AnnualMarketReturn { year: 2001, stock_return: -0.1189, bond_return: 0.0548, inflation_rate: 0.0283 },
    AnnualMarketReturn { year: 2002, stock_return: -0.2210, bond_return: 0.1584, inflation_rate: 0.0159 },
    AnnualMarketReturn { year: 2003, stock_return: 0.2869, bond_return: 0.0445, inflation_rate: 0.0227 },
    AnnualMarketReturn { year: 2004, stock_return: 0.1088, bond_return: 0.0434, inflation_rate: 0.0268 },
    AnnualMarketReturn { year: 2005, stock_return: 0.0491, bond_return: 0.0298, inflation_rate: 0.0339 },
    AnnualMarketReturn { year: 2006, stock_return: 0.1579, bond_return: 0.0196, inflation_rate: 0.0324 },
    AnnualMarketReturn { year: 2007, stock_return: 0.0549, bond_return: 0.1083, inflation_rate: 0.0285 },

    // Financial Crisis and Recovery (2008-2023)
    AnnualMarketReturn { year: 2008, stock_return: -0.3700, bond_return: 0.2516, inflation_rate: 0.0038 },
    AnnualMarketReturn { year: 2009, stock_return: 0.2646, bond_return: -0.1126, inflation_rate: -0.0036 },
    AnnualMarketReturn { year: 2010, stock_return: 0.1506, bond_return: 0.0871, inflation_rate: 0.0164 },
    AnnualMarketReturn { year: 2011, stock_return: 0.0210, bond_return: 0.2836, inflation_rate: 0.0315 },
    AnnualMarketReturn { year: 2012, stock_return: 0.1600, bond_return: 0.0310, inflation_rate: 0.0207 },
    AnnualMarketReturn { year: 2013, stock_return: 0.3239, bond_return: -0.1152, inflation_rate: 0.0150 },
    AnnualMarketReturn { year: 2014, stock_return: 0.1369, bond_return: 0.2513, inflation_rate: 0.0012 },
    AnnualMarketReturn { year: 2015, stock_return: 0.0138, bond_return: 0.0130, inflation_rate: 0.0012 },
    AnnualMarketReturn { year: 2016, stock_return: 0.1196, bond_return: 0.0165, inflation_rate: 0.0132 },
    AnnualMarketReturn { year: 2017, stock_return: 0.2183, bond_return: 0.0271, inflation_rate: 0.0213 },
    AnnualMarketReturn { year: 2018, stock_return: -0.0462, bond_return: 0.0086, inflation_rate: 0.0244 },
    AnnualMarketReturn { year: 2019, stock_return: 0.3157, bond_return: 0.0914, inflation_rate: 0.0181 },
    AnnualMarketReturn { year: 2020, stock_return: 0.1840, bond_return: 0.0743, inflation_rate: 0.0123 },
    AnnualMarketReturn { year: 2021, stock_return: 0.2889, bond_return: -0.0236, inflation_rate: 0.0470 },
    AnnualMarketReturn { year: 2022, stock_return: -0.1815, bond_return: -0.1319, inflation_rate: 0.0800 },
    AnnualMarketReturn { year: 2023, stock_return: 0.2626, bond_return: 0.0538, inflation_rate: 0.0410 },
];

/// Get a random historical year's returns using bootstrap sampling
pub fn sample_historical_returns<R: rand::Rng>(rng: &mut R) -> (f64, f64) {
    let random_year = &HISTORICAL_RETURNS[rng.gen_range(0..HISTORICAL_RETURNS.len())];
    
    // Convert nominal returns to real returns: real = (1 + nominal) / (1 + inflation) - 1
    let real_stock_return = (1.0 + random_year.stock_return) / (1.0 + random_year.inflation_rate) - 1.0;
    let real_bond_return = (1.0 + random_year.bond_return) / (1.0 + random_year.inflation_rate) - 1.0;
    
    (real_stock_return, real_bond_return)
}

/// Sample a block of consecutive years for block bootstrap
/// Returns real returns (adjusted for inflation)
pub fn sample_block<R: rand::Rng>(rng: &mut R, block_size: usize) -> Vec<(f64, f64)> {
    let max_start_index = HISTORICAL_RETURNS.len().saturating_sub(block_size);
    let start_index = if max_start_index > 0 {
        rng.gen_range(0..=max_start_index)
    } else {
        0
    };
    
    let block_size = block_size.min(HISTORICAL_RETURNS.len() - start_index);
    
    HISTORICAL_RETURNS[start_index..start_index + block_size]
        .iter()
        .map(|year_data| {
            // Convert nominal returns to real returns
            let real_stock_return = (1.0 + year_data.stock_return) / (1.0 + year_data.inflation_rate) - 1.0;
            let real_bond_return = (1.0 + year_data.bond_return) / (1.0 + year_data.inflation_rate) - 1.0;
            (real_stock_return, real_bond_return)
        })
        .collect()
}