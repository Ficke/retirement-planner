/**
 * Historical US Market Returns (Annual Data)
 * Source: SBBI Yearbook, Aswath Damodaran's data library, Robert Shiller data
 * Returns are NOMINAL for historical bootstrapping Monte Carlo
 * 
 * This comprehensive data set represents nearly 100 years of US market history:
 * - Great Depression (1929-1932)
 * - World War II era (1940s)
 * - Post-war boom (1950s-1960s)
 * - Stagflation period (1970s)
 * - Volcker recession and recovery (1980s)
 * - Great Moderation (1990s-2000s)
 * - Financial Crisis (2008-2009)
 * - Post-crisis recovery and COVID era (2010s-2020s)
 */

export interface AnnualMarketReturn {
  year: number;
  stock_return: number; // Annual nominal return for stocks (S&P 500 total return)
  bond_return: number;   // Annual nominal return for bonds (10-Year Treasury bonds)
  inflation_rate: number; // Annual CPI inflation rate
}

/**
 * Historical market returns from 1928-2023 (96 years of data).
 * Returns are NOMINAL as provided by SBBI and other historical sources.
 * 
 * Source: SBBI Yearbook, Aswath Damodaran's data library
 * Stocks: S&P 500 Total Return
 * Bonds: 10-Year Treasury Bonds 
 * Inflation: Consumer Price Index (CPI)
 */
export const HISTORICAL_RETURNS: AnnualMarketReturn[] = [
  // Pre-Depression and Great Depression Era (1928-1939)
  { year: 1928, stock_return: 0.4381, bond_return: 0.0084, inflation_rate: -0.0116 },
  { year: 1929, stock_return: -0.0830, bond_return: 0.0420, inflation_rate: 0.0000 },
  { year: 1930, stock_return: -0.2512, bond_return: 0.0454, inflation_rate: -0.0234 },
  { year: 1931, stock_return: -0.4384, bond_return: -0.0256, inflation_rate: -0.0880 },
  { year: 1932, stock_return: -0.0864, bond_return: 0.0879, inflation_rate: -0.1028 },
  { year: 1933, stock_return: 0.5299, bond_return: 0.0356, inflation_rate: 0.0093 },
  { year: 1934, stock_return: -0.0142, bond_return: 0.0782, inflation_rate: 0.0315 },
  { year: 1935, stock_return: 0.4674, bond_return: 0.0449, inflation_rate: 0.0253 },
  { year: 1936, stock_return: 0.3194, bond_return: 0.0514, inflation_rate: 0.0100 },
  { year: 1937, stock_return: -0.3534, bond_return: 0.0124, inflation_rate: 0.0370 },
  { year: 1938, stock_return: 0.2928, bond_return: 0.0429, inflation_rate: -0.0189 },
  { year: 1939, stock_return: -0.0110, bond_return: 0.0401, inflation_rate: -0.0134 },

  // World War II Era (1940-1949)
  { year: 1940, stock_return: -0.1067, bond_return: 0.0494, inflation_rate: 0.0076 },
  { year: 1941, stock_return: -0.1277, bond_return: -0.0229, inflation_rate: 0.0504 },
  { year: 1942, stock_return: 0.1917, bond_return: 0.0249, inflation_rate: 0.1091 },
  { year: 1943, stock_return: 0.2506, bond_return: 0.0188, inflation_rate: 0.0607 },
  { year: 1944, stock_return: 0.1903, bond_return: 0.0210, inflation_rate: 0.0173 },
  { year: 1945, stock_return: 0.3582, bond_return: 0.0336, inflation_rate: 0.0227 },
  { year: 1946, stock_return: -0.0843, bond_return: -0.0028, inflation_rate: 0.0833 },
  { year: 1947, stock_return: 0.0521, bond_return: -0.0051, inflation_rate: 0.1436 },
  { year: 1948, stock_return: 0.0570, bond_return: 0.0069, inflation_rate: 0.0772 },
  { year: 1949, stock_return: 0.1831, bond_return: 0.0384, inflation_rate: -0.0122 },

  // Post-war Boom (1950-1969)
  { year: 1950, stock_return: 0.3081, bond_return: 0.0113, inflation_rate: 0.0126 },
  { year: 1951, stock_return: 0.2368, bond_return: -0.0080, inflation_rate: 0.0789 },
  { year: 1952, stock_return: 0.1815, bond_return: 0.0142, inflation_rate: 0.0221 },
  { year: 1953, stock_return: -0.0121, bond_return: 0.0082, inflation_rate: 0.0079 },
  { year: 1954, stock_return: 0.5262, bond_return: 0.0371, inflation_rate: 0.0049 },
  { year: 1955, stock_return: 0.3256, bond_return: -0.0068, inflation_rate: -0.0034 },
  { year: 1956, stock_return: 0.0743, bond_return: -0.0305, inflation_rate: 0.0146 },
  { year: 1957, stock_return: -0.1047, bond_return: 0.0559, inflation_rate: 0.0336 },
  { year: 1958, stock_return: 0.4372, bond_return: -0.0024, inflation_rate: 0.0276 },
  { year: 1959, stock_return: 0.1196, bond_return: -0.0347, inflation_rate: 0.0084 },
  { year: 1960, stock_return: 0.0033, bond_return: 0.1009, inflation_rate: 0.0163 },
  { year: 1961, stock_return: 0.2664, bond_return: 0.0238, inflation_rate: 0.0104 },
  { year: 1962, stock_return: -0.0881, bond_return: 0.0532, inflation_rate: 0.0115 },
  { year: 1963, stock_return: 0.2261, bond_return: 0.0179, inflation_rate: 0.0123 },
  { year: 1964, stock_return: 0.1643, bond_return: 0.0289, inflation_rate: 0.0132 },
  { year: 1965, stock_return: 0.1241, bond_return: 0.0101, inflation_rate: 0.0169 },
  { year: 1966, stock_return: -0.1001, bond_return: 0.0289, inflation_rate: 0.0290 },
  { year: 1967, stock_return: 0.2380, bond_return: -0.0274, inflation_rate: 0.0288 },
  { year: 1968, stock_return: 0.1081, bond_return: 0.0210, inflation_rate: 0.0423 },
  { year: 1969, stock_return: -0.0842, bond_return: -0.0503, inflation_rate: 0.0544 },

  // Stagflation Period (1970-1979)
  { year: 1970, stock_return: 0.0393, bond_return: 0.1213, inflation_rate: 0.0584 },
  { year: 1971, stock_return: 0.1423, bond_return: 0.1322, inflation_rate: 0.0430 },
  { year: 1972, stock_return: 0.1887, bond_return: 0.0569, inflation_rate: 0.0327 },
  { year: 1973, stock_return: -0.1480, bond_return: 0.0429, inflation_rate: 0.0618 },
  { year: 1974, stock_return: -0.2642, bond_return: 0.0441, inflation_rate: 0.1105 },
  { year: 1975, stock_return: 0.3700, bond_return: 0.0918, inflation_rate: 0.0914 },
  { year: 1976, stock_return: 0.2361, bond_return: 0.1678, inflation_rate: 0.0574 },
  { year: 1977, stock_return: -0.0738, bond_return: 0.0297, inflation_rate: 0.0652 },
  { year: 1978, stock_return: 0.0642, bond_return: -0.0122, inflation_rate: 0.0763 },
  { year: 1979, stock_return: 0.1821, bond_return: -0.0116, inflation_rate: 0.1125 },

  // Volcker Era and Recovery (1980-1989)
  { year: 1980, stock_return: 0.3173, bond_return: -0.0392, inflation_rate: 0.1355 },
  { year: 1981, stock_return: -0.0504, bond_return: 0.0186, inflation_rate: 0.1033 },
  { year: 1982, stock_return: 0.2154, bond_return: 0.3262, inflation_rate: 0.0613 },
  { year: 1983, stock_return: 0.2248, bond_return: 0.0076, inflation_rate: 0.0321 },
  { year: 1984, stock_return: 0.0615, bond_return: 0.1560, inflation_rate: 0.0430 },
  { year: 1985, stock_return: 0.3164, bond_return: 0.2130, inflation_rate: 0.0355 },
  { year: 1986, stock_return: 0.1857, bond_return: 0.1557, inflation_rate: 0.0190 },
  { year: 1987, stock_return: 0.0513, bond_return: -0.0267, inflation_rate: 0.0366 },
  { year: 1988, stock_return: 0.1661, bond_return: 0.0772, inflation_rate: 0.0414 },
  { year: 1989, stock_return: 0.3149, bond_return: 0.1415, inflation_rate: 0.0483 },

  // Great Moderation Begins (1990-1999)
  { year: 1990, stock_return: -0.0317, bond_return: 0.0619, inflation_rate: 0.0540 },
  { year: 1991, stock_return: 0.3023, bond_return: 0.1593, inflation_rate: 0.0423 },
  { year: 1992, stock_return: 0.0743, bond_return: 0.0702, inflation_rate: 0.0303 },
  { year: 1993, stock_return: 0.0989, bond_return: 0.0975, inflation_rate: 0.0296 },
  { year: 1994, stock_return: 0.0122, bond_return: -0.0778, inflation_rate: 0.0261 },
  { year: 1995, stock_return: 0.3720, bond_return: 0.1846, inflation_rate: 0.0281 },
  { year: 1996, stock_return: 0.2268, bond_return: 0.0363, inflation_rate: 0.0293 },
  { year: 1997, stock_return: 0.3310, bond_return: 0.0963, inflation_rate: 0.0234 },
  { year: 1998, stock_return: 0.2834, bond_return: 0.1492, inflation_rate: 0.0155 },
  { year: 1999, stock_return: 0.2089, bond_return: -0.0825, inflation_rate: 0.0219 },

  // Dot-com Crash and Recovery (2000-2009)
  { year: 2000, stock_return: -0.0903, bond_return: 0.1666, inflation_rate: 0.0338 },
  { year: 2001, stock_return: -0.1185, bond_return: 0.0841, inflation_rate: 0.0283 },
  { year: 2002, stock_return: -0.2197, bond_return: 0.1026, inflation_rate: 0.0159 },
  { year: 2003, stock_return: 0.2836, bond_return: 0.0399, inflation_rate: 0.0227 },
  { year: 2004, stock_return: 0.1074, bond_return: 0.0427, inflation_rate: 0.0268 },
  { year: 2005, stock_return: 0.0483, bond_return: 0.0242, inflation_rate: 0.0339 },
  { year: 2006, stock_return: 0.1561, bond_return: 0.0223, inflation_rate: 0.0323 },
  { year: 2007, stock_return: 0.0548, bond_return: 0.0697, inflation_rate: 0.0285 },
  { year: 2008, stock_return: -0.3655, bond_return: 0.0470, inflation_rate: 0.0384 },
  { year: 2009, stock_return: 0.2594, bond_return: -0.1112, inflation_rate: -0.0036 },

  // Post-Financial Crisis Era (2010-2023)
  { year: 2010, stock_return: 0.1482, bond_return: 0.0654, inflation_rate: 0.0164 },
  { year: 2011, stock_return: 0.0210, bond_return: 0.1604, inflation_rate: 0.0316 },
  { year: 2012, stock_return: 0.1589, bond_return: 0.0298, inflation_rate: 0.0207 },
  { year: 2013, stock_return: 0.3215, bond_return: -0.0202, inflation_rate: 0.0146 },
  { year: 2014, stock_return: 0.1352, bond_return: 0.1075, inflation_rate: 0.0162 },
  { year: 2015, stock_return: 0.0138, bond_return: 0.0125, inflation_rate: 0.0012 },
  { year: 2016, stock_return: 0.1177, bond_return: 0.0099, inflation_rate: 0.0126 },
  { year: 2017, stock_return: 0.2161, bond_return: 0.0311, inflation_rate: 0.0213 },
  { year: 2018, stock_return: -0.0441, bond_return: 0.0015, inflation_rate: 0.0244 },
  { year: 2019, stock_return: 0.3121, bond_return: 0.0953, inflation_rate: 0.0181 },
  { year: 2020, stock_return: 0.1805, bond_return: 0.1184, inflation_rate: 0.0123 },
  { year: 2021, stock_return: 0.2847, bond_return: -0.0433, inflation_rate: 0.0470 },
  { year: 2022, stock_return: -0.1811, bond_return: -0.1691, inflation_rate: 0.0800 },
  { year: 2023, stock_return: 0.2629, bond_return: 0.0405, inflation_rate: 0.0410 },
];

/**
 * Get summary statistics for the historical data.
 * Useful for validation and comparison with parametric models.
 */
export function getHistoricalStats() {
  const stockReturns = HISTORICAL_RETURNS.map(r => r.stock_return);
  const bondReturns = HISTORICAL_RETURNS.map(r => r.bond_return);
  
  const mean = (arr: number[]) => arr.reduce((sum, val) => sum + val, 0) / arr.length;
  const std = (arr: number[]) => {
    const avg = mean(arr);
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
  };
  const correlation = (x: number[], y: number[]) => {
    const n = x.length;
    const meanX = mean(x);
    const meanY = mean(y);
    let numerator = 0;
    let sumSqX = 0;
    let sumSqY = 0;
    
    for (let i = 0; i < n; i++) {
      numerator += (x[i] - meanX) * (y[i] - meanY);
      sumSqX += Math.pow(x[i] - meanX, 2);
      sumSqY += Math.pow(y[i] - meanY, 2);
    }
    
    return numerator / Math.sqrt(sumSqX * sumSqY);
  };

  return {
    stocks: {
      mean: mean(stockReturns),
      std: std(stockReturns),
      min: Math.min(...stockReturns),
      max: Math.max(...stockReturns)
    },
    bonds: {
      mean: mean(bondReturns),
      std: std(bondReturns),
      min: Math.min(...bondReturns),
      max: Math.max(...bondReturns)
    },
    correlation: correlation(stockReturns, bondReturns),
    years: HISTORICAL_RETURNS.length
  };
}