/**
 * Historical US Market Returns (Annual, 1928–2025)
 *
 * CANONICAL DATASET — single source of truth for both simulation engines.
 * The Rust table (rust-simulation-service/src/simulation/historical_data.rs)
 * is GENERATED from this file. After editing, run:
 *   node scripts/gen-rust-historical-data.mjs
 *
 * Sources:
 * - Stocks and bonds: Damodaran's annual returns workbook (NYU Stern), using
 *   "S&P 500 (includes dividends)" and "US T. Bond (10-year)".
 *   https://pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls
 * - Inflation: BLS CPI-U, all items, not seasonally adjusted (CUUR0000SA0),
 *   calculated December to December.
 *   https://data.bls.gov/timeseries/CUUR0000SA0
 *
 * Store stock and bond returns to four decimal places and inflation to three,
 * matching the precision of the existing history. After adding a year, run the
 * generator above; CI verifies that the Rust copy is current and years are
 * consecutive.
 *
 * Returns are NOMINAL; the engines convert to real returns per-year via
 * real = (1 + nominal) / (1 + inflation) - 1.
 */

export interface AnnualMarketReturn {
  year: number;
  /** Annual nominal total return for the S&P 500. */
  stock_return: number;
  /** Annual nominal total return for the 10-year US Treasury. */
  bond_return: number;
  /** CPI-U inflation from December of the previous year to December. */
  inflation_rate: number;
}

export const HISTORICAL_RETURNS: AnnualMarketReturn[] = [
  { year: 1928, stock_return: 0.4381, bond_return: 0.0084, inflation_rate: -0.012 },
  { year: 1929, stock_return: -0.083, bond_return: 0.042, inflation_rate: 0.006 },
  { year: 1930, stock_return: -0.2512, bond_return: 0.0454, inflation_rate: -0.064 },
  { year: 1931, stock_return: -0.4384, bond_return: -0.0256, inflation_rate: -0.093 },
  { year: 1932, stock_return: -0.0864, bond_return: 0.0879, inflation_rate: -0.103 },
  { year: 1933, stock_return: 0.4998, bond_return: 0.0186, inflation_rate: 0.008 },
  { year: 1934, stock_return: -0.0119, bond_return: 0.0796, inflation_rate: 0.015 },
  { year: 1935, stock_return: 0.4674, bond_return: 0.0447, inflation_rate: 0.03 },
  { year: 1936, stock_return: 0.3194, bond_return: 0.0502, inflation_rate: 0.014 },
  { year: 1937, stock_return: -0.3534, bond_return: 0.0138, inflation_rate: 0.029 },
  { year: 1938, stock_return: 0.2928, bond_return: 0.0421, inflation_rate: -0.028 },
  { year: 1939, stock_return: -0.011, bond_return: 0.0441, inflation_rate: 0 },
  { year: 1940, stock_return: -0.1067, bond_return: 0.054, inflation_rate: 0.007 },
  { year: 1941, stock_return: -0.1277, bond_return: -0.0202, inflation_rate: 0.099 },
  { year: 1942, stock_return: 0.1917, bond_return: 0.0229, inflation_rate: 0.09 },
  { year: 1943, stock_return: 0.2506, bond_return: 0.0249, inflation_rate: 0.03 },
  { year: 1944, stock_return: 0.1903, bond_return: 0.0258, inflation_rate: 0.023 },
  { year: 1945, stock_return: 0.3582, bond_return: 0.038, inflation_rate: 0.022 },
  { year: 1946, stock_return: -0.0843, bond_return: 0.0313, inflation_rate: 0.181 },
  { year: 1947, stock_return: 0.052, bond_return: 0.0092, inflation_rate: 0.088 },
  { year: 1948, stock_return: 0.057, bond_return: 0.0195, inflation_rate: 0.03 },
  { year: 1949, stock_return: 0.183, bond_return: 0.0466, inflation_rate: -0.021 },
  { year: 1950, stock_return: 0.3081, bond_return: 0.0043, inflation_rate: 0.059 },
  { year: 1951, stock_return: 0.2368, bond_return: -0.003, inflation_rate: 0.06 },
  { year: 1952, stock_return: 0.1815, bond_return: 0.0227, inflation_rate: 0.008 },
  { year: 1953, stock_return: -0.0121, bond_return: 0.0414, inflation_rate: 0.007 },
  { year: 1954, stock_return: 0.5256, bond_return: 0.0329, inflation_rate: -0.007 },
  { year: 1955, stock_return: 0.326, bond_return: -0.0134, inflation_rate: 0.004 },
  { year: 1956, stock_return: 0.0744, bond_return: -0.0226, inflation_rate: 0.03 },
  { year: 1957, stock_return: -0.1046, bond_return: 0.068, inflation_rate: 0.029 },
  { year: 1958, stock_return: 0.4372, bond_return: -0.021, inflation_rate: 0.018 },
  { year: 1959, stock_return: 0.1206, bond_return: -0.0265, inflation_rate: 0.017 },
  { year: 1960, stock_return: 0.0034, bond_return: 0.1164, inflation_rate: 0.014 },
  { year: 1961, stock_return: 0.2664, bond_return: 0.0206, inflation_rate: 0.007 },
  { year: 1962, stock_return: -0.0881, bond_return: 0.0569, inflation_rate: 0.013 },
  { year: 1963, stock_return: 0.2261, bond_return: 0.0168, inflation_rate: 0.016 },
  { year: 1964, stock_return: 0.1642, bond_return: 0.0373, inflation_rate: 0.01 },
  { year: 1965, stock_return: 0.124, bond_return: 0.0072, inflation_rate: 0.019 },
  { year: 1966, stock_return: -0.0997, bond_return: 0.0291, inflation_rate: 0.035 },
  { year: 1967, stock_return: 0.238, bond_return: -0.0158, inflation_rate: 0.03 },
  { year: 1968, stock_return: 0.1081, bond_return: 0.0327, inflation_rate: 0.047 },
  { year: 1969, stock_return: -0.0824, bond_return: -0.0501, inflation_rate: 0.062 },
  { year: 1970, stock_return: 0.0356, bond_return: 0.1675, inflation_rate: 0.056 },
  { year: 1971, stock_return: 0.1422, bond_return: 0.0979, inflation_rate: 0.033 },
  { year: 1972, stock_return: 0.1876, bond_return: 0.0282, inflation_rate: 0.034 },
  { year: 1973, stock_return: -0.1431, bond_return: 0.0366, inflation_rate: 0.087 },
  { year: 1974, stock_return: -0.259, bond_return: 0.0199, inflation_rate: 0.123 },
  { year: 1975, stock_return: 0.37, bond_return: 0.0361, inflation_rate: 0.069 },
  { year: 1976, stock_return: 0.2383, bond_return: 0.1598, inflation_rate: 0.049 },
  { year: 1977, stock_return: -0.0698, bond_return: 0.0129, inflation_rate: 0.067 },
  { year: 1978, stock_return: 0.0651, bond_return: -0.0078, inflation_rate: 0.09 },
  { year: 1979, stock_return: 0.1852, bond_return: 0.0067, inflation_rate: 0.133 },
  { year: 1980, stock_return: 0.3174, bond_return: -0.0299, inflation_rate: 0.125 },
  { year: 1981, stock_return: -0.047, bond_return: 0.082, inflation_rate: 0.089 },
  { year: 1982, stock_return: 0.2042, bond_return: 0.3281, inflation_rate: 0.038 },
  { year: 1983, stock_return: 0.2234, bond_return: 0.032, inflation_rate: 0.038 },
  { year: 1984, stock_return: 0.0615, bond_return: 0.1373, inflation_rate: 0.039 },
  { year: 1985, stock_return: 0.3124, bond_return: 0.2571, inflation_rate: 0.038 },
  { year: 1986, stock_return: 0.1849, bond_return: 0.2428, inflation_rate: 0.011 },
  { year: 1987, stock_return: 0.0581, bond_return: -0.0496, inflation_rate: 0.044 },
  { year: 1988, stock_return: 0.1654, bond_return: 0.0822, inflation_rate: 0.044 },
  { year: 1989, stock_return: 0.3148, bond_return: 0.1769, inflation_rate: 0.046 },
  { year: 1990, stock_return: -0.0306, bond_return: 0.0624, inflation_rate: 0.061 },
  { year: 1991, stock_return: 0.3023, bond_return: 0.15, inflation_rate: 0.031 },
  { year: 1992, stock_return: 0.0749, bond_return: 0.0936, inflation_rate: 0.029 },
  { year: 1993, stock_return: 0.0997, bond_return: 0.1421, inflation_rate: 0.027 },
  { year: 1994, stock_return: 0.0133, bond_return: -0.0804, inflation_rate: 0.027 },
  { year: 1995, stock_return: 0.372, bond_return: 0.2348, inflation_rate: 0.025 },
  { year: 1996, stock_return: 0.2268, bond_return: 0.0143, inflation_rate: 0.033 },
  { year: 1997, stock_return: 0.331, bond_return: 0.0994, inflation_rate: 0.017 },
  { year: 1998, stock_return: 0.2834, bond_return: 0.1492, inflation_rate: 0.016 },
  { year: 1999, stock_return: 0.2089, bond_return: -0.0825, inflation_rate: 0.027 },
  { year: 2000, stock_return: -0.0903, bond_return: 0.1666, inflation_rate: 0.034 },
  { year: 2001, stock_return: -0.1185, bond_return: 0.0557, inflation_rate: 0.016 },
  { year: 2002, stock_return: -0.2197, bond_return: 0.1512, inflation_rate: 0.024 },
  { year: 2003, stock_return: 0.2836, bond_return: 0.0038, inflation_rate: 0.019 },
  { year: 2004, stock_return: 0.1074, bond_return: 0.0449, inflation_rate: 0.033 },
  { year: 2005, stock_return: 0.0483, bond_return: 0.0287, inflation_rate: 0.034 },
  { year: 2006, stock_return: 0.1561, bond_return: 0.0196, inflation_rate: 0.025 },
  { year: 2007, stock_return: 0.0548, bond_return: 0.1021, inflation_rate: 0.041 },
  { year: 2008, stock_return: -0.3655, bond_return: 0.201, inflation_rate: 0.001 },
  { year: 2009, stock_return: 0.2594, bond_return: -0.1112, inflation_rate: 0.027 },
  { year: 2010, stock_return: 0.1482, bond_return: 0.0846, inflation_rate: 0.015 },
  { year: 2011, stock_return: 0.021, bond_return: 0.1604, inflation_rate: 0.03 },
  { year: 2012, stock_return: 0.1589, bond_return: 0.0297, inflation_rate: 0.017 },
  { year: 2013, stock_return: 0.3215, bond_return: -0.091, inflation_rate: 0.015 },
  { year: 2014, stock_return: 0.1352, bond_return: 0.1075, inflation_rate: 0.008 },
  { year: 2015, stock_return: 0.0138, bond_return: 0.0128, inflation_rate: 0.007 },
  { year: 2016, stock_return: 0.1177, bond_return: 0.0069, inflation_rate: 0.021 },
  { year: 2017, stock_return: 0.2161, bond_return: 0.028, inflation_rate: 0.021 },
  { year: 2018, stock_return: -0.0423, bond_return: -0.0002, inflation_rate: 0.019 },
  { year: 2019, stock_return: 0.3121, bond_return: 0.0964, inflation_rate: 0.023 },
  { year: 2020, stock_return: 0.1802, bond_return: 0.1133, inflation_rate: 0.014 },
  { year: 2021, stock_return: 0.2847, bond_return: -0.0442, inflation_rate: 0.07 },
  { year: 2022, stock_return: -0.1804, bond_return: -0.1783, inflation_rate: 0.065 },
  { year: 2023, stock_return: 0.2606, bond_return: 0.0388, inflation_rate: 0.034 },
  { year: 2024, stock_return: 0.2488, bond_return: -0.0164, inflation_rate: 0.029 },
  { year: 2025, stock_return: 0.1772, bond_return: 0.078, inflation_rate: 0.027 },
];
