#!/usr/bin/env node
/**
 * Regenerates rust-simulation-service/src/simulation/historical_data.rs from
 * the canonical dataset in apps/web/src/data/market-history-annual.ts, so the
 * two simulation engines always sample the same market history.
 *
 * Usage: node scripts/gen-rust-historical-data.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsPath = join(root, 'apps/web/src/data/market-history-annual.ts');
const rsPath = join(root, 'rust-simulation-service/src/simulation/historical_data.rs');
const checkOnly = process.argv.includes('--check');

const ts = readFileSync(tsPath, 'utf8');
const rowRe = /year:\s*(\d{4}),\s*stock_return:\s*(-?[\d.]+),\s*bond_return:\s*(-?[\d.]+),\s*inflation_rate:\s*(-?[\d.]+),\s*dividend_yield:\s*(-?[\d.]+)/g;

const rows = [];
let m;
while ((m = rowRe.exec(ts))) {
  rows.push({ year: m[1], stock: m[2], bond: m[3], inflation: m[4], dividend: m[5] });
}
if (rows.length < 90) {
  throw new Error(`Parsed only ${rows.length} rows from ${tsPath} — parser or data problem`);
}

for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const values = [row.stock, row.bond, row.inflation, row.dividend].map(Number);
  if (!values.every(Number.isFinite) || values.some((value) => value <= -1)) {
    throw new Error(`Invalid return data for ${row.year} in ${tsPath}`);
  }
  // A dividend yield outside this range is a decimal-point slip, not a market.
  if (Number(row.dividend) < 0 || Number(row.dividend) > 0.2) {
    throw new Error(`Implausible dividend yield ${row.dividend} for ${row.year} in ${tsPath}`);
  }
  if (index > 0 && Number(row.year) !== Number(rows[index - 1].year) + 1) {
    throw new Error(
      `Historical years must be unique and consecutive; found ${rows[index - 1].year} then ${row.year}`,
    );
  }
}

const first = rows[0].year;
const last = rows[rows.length - 1].year;

const rustRows = rows
  .map(r => `    AnnualMarketReturn {
        year: ${r.year},
        stock_return: ${num(r.stock)},
        bond_return: ${num(r.bond)},
        inflation_rate: ${num(r.inflation)},
        dividend_yield: ${num(r.dividend)},
    },`)
  .join('\n');

function num(s) {
  return s.includes('.') ? s : `${s}.0`;
}

const out = `// This file is generated; do not edit it by hand.
// The source of truth is apps/web/src/data/market-history-annual.ts.
// Regenerate it with: node scripts/gen-rust-historical-data.mjs
//
// Historical US market returns, ${first}-${last} (${rows.length} years).
// Stocks: S&P 500 total return; Bonds: 10-year US Treasury total return;
// dividend yield: dividends over the opening index level (Damodaran data
// library, NYU Stern). Inflation: CPI-U Dec/Dec (BLS).
// Returns are NOMINAL; sampling converts to real returns per-year.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnualMarketReturn {
    pub year: u32,
    pub stock_return: f64,
    pub bond_return: f64,
    pub inflation_rate: f64,
    pub dividend_yield: f64,
}

pub const HISTORICAL_RETURNS: &[AnnualMarketReturn] = &[
${rustRows}
];

/// Samples a random historical year's returns using bootstrap sampling.
/// The returned values are real returns: real = (1 + nominal) / (1 + inflation) - 1.
pub fn sample_historical_returns<R: rand::Rng>(rng: &mut R) -> (f64, f64) {
    let random_year = &HISTORICAL_RETURNS[rng.gen_range(0..HISTORICAL_RETURNS.len())];

    let real_stock_return =
        (1.0 + random_year.stock_return) / (1.0 + random_year.inflation_rate) - 1.0;
    let real_bond_return =
        (1.0 + random_year.bond_return) / (1.0 + random_year.inflation_rate) - 1.0;

    (real_stock_return, real_bond_return)
}

/// Samples a block of consecutive years for block bootstrap.
/// The returned values are adjusted for inflation.
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
`;

if (checkOnly) {
  const current = readFileSync(rsPath, 'utf8');
  if (current !== out) {
    throw new Error(
      `${rsPath} is stale. Run node scripts/gen-rust-historical-data.mjs and commit the result.`,
    );
  }
  console.log(`Historical data is current: ${rows.length} years (${first}-${last})`);
} else {
  writeFileSync(rsPath, out);
  console.log(`Wrote ${rows.length} years (${first}-${last}) to ${rsPath}`);
}
