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
 * - Dividend yield: the same workbook's "S&P 500 & Raw Data" sheet, dividends
 *   for the year over the prior year-end index level. Shiller's series is not
 *   interchangeable here: his monthly price is an average of daily closes
 *   rather than a month-end close, which moves a yield by up to 3.6pp in the
 *   1930s.
 *
 * Store stock and bond returns and dividend yield to four decimal places and
 * inflation to three, matching the precision of the existing history. After adding a year, run the
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
  /**
   * Dividends paid during the year over the index level that opened it, so
   * `stock_return - dividend_yield` is that year's price appreciation. Taken
   * from the same Damodaran rows as `stock_return`, which is what makes the
   * split exact rather than approximate.
   */
  dividend_yield: number;
}

export const HISTORICAL_RETURNS: AnnualMarketReturn[] = [
  { year: 1928, stock_return: 0.4381, bond_return: 0.0084, inflation_rate: -0.012, dividend_yield: 0.0593 },
  { year: 1929, stock_return: -0.083, bond_return: 0.042, inflation_rate: 0.006, dividend_yield: 0.0361 },
  { year: 1930, stock_return: -0.2512, bond_return: 0.0454, inflation_rate: -0.064, dividend_yield: 0.0336 },
  { year: 1931, stock_return: -0.4384, bond_return: -0.0256, inflation_rate: -0.093, dividend_yield: 0.0323 },
  { year: 1932, stock_return: -0.0864, bond_return: 0.0879, inflation_rate: -0.103, dividend_yield: 0.0614 },
  { year: 1933, stock_return: 0.4998, bond_return: 0.0186, inflation_rate: 0.008, dividend_yield: 0.0591 },
  { year: 1934, stock_return: -0.0119, bond_return: 0.0796, inflation_rate: 0.015, dividend_yield: 0.0353 },
  { year: 1935, stock_return: 0.4674, bond_return: 0.0447, inflation_rate: 0.03, dividend_yield: 0.0537 },
  { year: 1936, stock_return: 0.3194, bond_return: 0.0502, inflation_rate: 0.014, dividend_yield: 0.0402 },
  { year: 1937, stock_return: -0.3534, bond_return: 0.0138, inflation_rate: 0.029, dividend_yield: 0.0325 },
  { year: 1938, stock_return: 0.2928, bond_return: 0.0421, inflation_rate: -0.028, dividend_yield: 0.0473 },
  { year: 1939, stock_return: -0.011, bond_return: 0.0441, inflation_rate: 0, dividend_yield: 0.0408 },
  { year: 1940, stock_return: -0.1067, bond_return: 0.054, inflation_rate: 0.007, dividend_yield: 0.0442 },
  { year: 1941, stock_return: -0.1277, bond_return: -0.0202, inflation_rate: 0.099, dividend_yield: 0.0509 },
  { year: 1942, stock_return: 0.1917, bond_return: 0.0229, inflation_rate: 0.09, dividend_yield: 0.0675 },
  { year: 1943, stock_return: 0.2506, bond_return: 0.0249, inflation_rate: 0.03, dividend_yield: 0.0561 },
  { year: 1944, stock_return: 0.1903, bond_return: 0.0258, inflation_rate: 0.023, dividend_yield: 0.0523 },
  { year: 1945, stock_return: 0.3582, bond_return: 0.038, inflation_rate: 0.022, dividend_yield: 0.0510 },
  { year: 1946, stock_return: -0.0843, bond_return: 0.0313, inflation_rate: 0.181, dividend_yield: 0.0344 },
  { year: 1947, stock_return: 0.052, bond_return: 0.0092, inflation_rate: 0.088, dividend_yield: 0.0520 },
  { year: 1948, stock_return: 0.057, bond_return: 0.0195, inflation_rate: 0.03, dividend_yield: 0.0636 },
  { year: 1949, stock_return: 0.183, bond_return: 0.0466, inflation_rate: -0.021, dividend_yield: 0.0784 },
  { year: 1950, stock_return: 0.3081, bond_return: 0.0043, inflation_rate: 0.059, dividend_yield: 0.0913 },
  { year: 1951, stock_return: 0.2368, bond_return: -0.003, inflation_rate: 0.06, dividend_yield: 0.0733 },
  { year: 1952, stock_return: 0.1815, bond_return: 0.0227, inflation_rate: 0.008, dividend_yield: 0.0637 },
  { year: 1953, stock_return: -0.0121, bond_return: 0.0414, inflation_rate: 0.007, dividend_yield: 0.0542 },
  { year: 1954, stock_return: 0.5256, bond_return: 0.0329, inflation_rate: -0.007, dividend_yield: 0.0754 },
  { year: 1955, stock_return: 0.326, bond_return: -0.0134, inflation_rate: 0.004, dividend_yield: 0.0619 },
  { year: 1956, stock_return: 0.0744, bond_return: -0.0226, inflation_rate: 0.03, dividend_yield: 0.0482 },
  { year: 1957, stock_return: -0.1046, bond_return: 0.068, inflation_rate: 0.029, dividend_yield: 0.0386 },
  { year: 1958, stock_return: 0.4372, bond_return: -0.021, inflation_rate: 0.018, dividend_yield: 0.0566 },
  { year: 1959, stock_return: 0.1206, bond_return: -0.0265, inflation_rate: 0.017, dividend_yield: 0.0358 },
  { year: 1960, stock_return: 0.0034, bond_return: 0.1164, inflation_rate: 0.014, dividend_yield: 0.0331 },
  { year: 1961, stock_return: 0.2664, bond_return: 0.0206, inflation_rate: 0.007, dividend_yield: 0.0351 },
  { year: 1962, stock_return: -0.0881, bond_return: 0.0569, inflation_rate: 0.013, dividend_yield: 0.0300 },
  { year: 1963, stock_return: 0.2261, bond_return: 0.0168, inflation_rate: 0.016, dividend_yield: 0.0372 },
  { year: 1964, stock_return: 0.1642, bond_return: 0.0373, inflation_rate: 0.01, dividend_yield: 0.0345 },
  { year: 1965, stock_return: 0.124, bond_return: 0.0072, inflation_rate: 0.019, dividend_yield: 0.0334 },
  { year: 1966, stock_return: -0.0997, bond_return: 0.0291, inflation_rate: 0.035, dividend_yield: 0.0312 },
  { year: 1967, stock_return: 0.238, bond_return: -0.0158, inflation_rate: 0.03, dividend_yield: 0.0371 },
  { year: 1968, stock_return: 0.1081, bond_return: 0.0327, inflation_rate: 0.047, dividend_yield: 0.0315 },
  { year: 1969, stock_return: -0.0824, bond_return: -0.0501, inflation_rate: 0.062, dividend_yield: 0.0312 },
  { year: 1970, stock_return: 0.0356, bond_return: 0.1675, inflation_rate: 0.056, dividend_yield: 0.0346 },
  { year: 1971, stock_return: 0.1422, bond_return: 0.0979, inflation_rate: 0.033, dividend_yield: 0.0343 },
  { year: 1972, stock_return: 0.1876, bond_return: 0.0282, inflation_rate: 0.034, dividend_yield: 0.0312 },
  { year: 1973, stock_return: -0.1431, bond_return: 0.0366, inflation_rate: 0.087, dividend_yield: 0.0306 },
  { year: 1974, stock_return: -0.259, bond_return: 0.0199, inflation_rate: 0.123, dividend_yield: 0.0382 },
  { year: 1975, stock_return: 0.37, bond_return: 0.0361, inflation_rate: 0.069, dividend_yield: 0.0545 },
  { year: 1976, stock_return: 0.2383, bond_return: 0.1598, inflation_rate: 0.049, dividend_yield: 0.0468 },
  { year: 1977, stock_return: -0.0698, bond_return: 0.0129, inflation_rate: 0.067, dividend_yield: 0.0452 },
  { year: 1978, stock_return: 0.0651, bond_return: -0.0078, inflation_rate: 0.09, dividend_yield: 0.0545 },
  { year: 1979, stock_return: 0.1852, bond_return: 0.0067, inflation_rate: 0.133, dividend_yield: 0.0621 },
  { year: 1980, stock_return: 0.3174, bond_return: -0.0299, inflation_rate: 0.125, dividend_yield: 0.0596 },
  { year: 1981, stock_return: -0.047, bond_return: 0.082, inflation_rate: 0.089, dividend_yield: 0.0503 },
  { year: 1982, stock_return: 0.2042, bond_return: 0.3281, inflation_rate: 0.038, dividend_yield: 0.0566 },
  { year: 1983, stock_return: 0.2234, bond_return: 0.032, inflation_rate: 0.038, dividend_yield: 0.0507 },
  { year: 1984, stock_return: 0.0615, bond_return: 0.1373, inflation_rate: 0.039, dividend_yield: 0.0475 },
  { year: 1985, stock_return: 0.3124, bond_return: 0.2571, inflation_rate: 0.038, dividend_yield: 0.0490 },
  { year: 1986, stock_return: 0.1849, bond_return: 0.2428, inflation_rate: 0.011, dividend_yield: 0.0387 },
  { year: 1987, stock_return: 0.0581, bond_return: -0.0496, inflation_rate: 0.044, dividend_yield: 0.0379 },
  { year: 1988, stock_return: 0.1654, bond_return: 0.0822, inflation_rate: 0.044, dividend_yield: 0.0414 },
  { year: 1989, stock_return: 0.3148, bond_return: 0.1769, inflation_rate: 0.046, dividend_yield: 0.0422 },
  { year: 1990, stock_return: -0.0306, bond_return: 0.0624, inflation_rate: 0.061, dividend_yield: 0.0349 },
  { year: 1991, stock_return: 0.3023, bond_return: 0.15, inflation_rate: 0.031, dividend_yield: 0.0393 },
  { year: 1992, stock_return: 0.0749, bond_return: 0.0936, inflation_rate: 0.029, dividend_yield: 0.0303 },
  { year: 1993, stock_return: 0.0997, bond_return: 0.1421, inflation_rate: 0.027, dividend_yield: 0.0291 },
  { year: 1994, stock_return: 0.0133, bond_return: -0.0804, inflation_rate: 0.027, dividend_yield: 0.0287 },
  { year: 1995, stock_return: 0.372, bond_return: 0.2348, inflation_rate: 0.025, dividend_yield: 0.0308 },
  { year: 1996, stock_return: 0.2268, bond_return: 0.0143, inflation_rate: 0.033, dividend_yield: 0.0242 },
  { year: 1997, stock_return: 0.331, bond_return: 0.0994, inflation_rate: 0.017, dividend_yield: 0.0210 },
  { year: 1998, stock_return: 0.2834, bond_return: 0.1492, inflation_rate: 0.016, dividend_yield: 0.0167 },
  { year: 1999, stock_return: 0.2089, bond_return: -0.0825, inflation_rate: 0.027, dividend_yield: 0.0136 },
  { year: 2000, stock_return: -0.0903, bond_return: 0.1666, inflation_rate: 0.034, dividend_yield: 0.0111 },
  { year: 2001, stock_return: -0.1185, bond_return: 0.0557, inflation_rate: 0.016, dividend_yield: 0.0119 },
  { year: 2002, stock_return: -0.2197, bond_return: 0.1512, inflation_rate: 0.024, dividend_yield: 0.0140 },
  { year: 2003, stock_return: 0.2836, bond_return: 0.0038, inflation_rate: 0.019, dividend_yield: 0.0198 },
  { year: 2004, stock_return: 0.1074, bond_return: 0.0449, inflation_rate: 0.033, dividend_yield: 0.0175 },
  { year: 2005, stock_return: 0.0483, bond_return: 0.0287, inflation_rate: 0.034, dividend_yield: 0.0183 },
  { year: 2006, stock_return: 0.1561, bond_return: 0.0196, inflation_rate: 0.025, dividend_yield: 0.0199 },
  { year: 2007, stock_return: 0.0548, bond_return: 0.1021, inflation_rate: 0.041, dividend_yield: 0.0196 },
  { year: 2008, stock_return: -0.3655, bond_return: 0.201, inflation_rate: 0.001, dividend_yield: 0.0193 },
  { year: 2009, stock_return: 0.2594, bond_return: -0.1112, inflation_rate: 0.027, dividend_yield: 0.0248 },
  { year: 2010, stock_return: 0.1482, bond_return: 0.0846, inflation_rate: 0.015, dividend_yield: 0.0204 },
  { year: 2011, stock_return: 0.021, bond_return: 0.1604, inflation_rate: 0.03, dividend_yield: 0.0210 },
  { year: 2012, stock_return: 0.1589, bond_return: 0.0297, inflation_rate: 0.017, dividend_yield: 0.0248 },
  { year: 2013, stock_return: 0.3215, bond_return: -0.091, inflation_rate: 0.015, dividend_yield: 0.0254 },
  { year: 2014, stock_return: 0.1352, bond_return: 0.1075, inflation_rate: 0.008, dividend_yield: 0.0213 },
  { year: 2015, stock_return: 0.0138, bond_return: 0.0128, inflation_rate: 0.007, dividend_yield: 0.0211 },
  { year: 2016, stock_return: 0.1177, bond_return: 0.0069, inflation_rate: 0.021, dividend_yield: 0.0224 },
  { year: 2017, stock_return: 0.2161, bond_return: 0.028, inflation_rate: 0.021, dividend_yield: 0.0219 },
  { year: 2018, stock_return: -0.0423, bond_return: -0.0002, inflation_rate: 0.019, dividend_yield: 0.0201 },
  { year: 2019, stock_return: 0.3121, bond_return: 0.0964, inflation_rate: 0.023, dividend_yield: 0.0233 },
  { year: 2020, stock_return: 0.1802, bond_return: 0.1133, inflation_rate: 0.014, dividend_yield: 0.0176 },
  { year: 2021, stock_return: 0.2847, bond_return: -0.0442, inflation_rate: 0.07, dividend_yield: 0.0158 },
  { year: 2022, stock_return: -0.1804, bond_return: -0.1783, inflation_rate: 0.065, dividend_yield: 0.0141 },
  { year: 2023, stock_return: 0.2606, bond_return: 0.0388, inflation_rate: 0.034, dividend_yield: 0.0183 },
  { year: 2024, stock_return: 0.2488, bond_return: -0.0164, inflation_rate: 0.029, dividend_yield: 0.0157 },
  { year: 2025, stock_return: 0.1772, bond_return: 0.078, inflation_rate: 0.027, dividend_yield: 0.0134 },
];
