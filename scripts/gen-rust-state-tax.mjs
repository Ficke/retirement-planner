#!/usr/bin/env node
/**
 * Regenerates rust-simulation-service/src/simulation/state_tax.rs from the
 * state table in apps/web/src/data/state-tax.ts and the bracket schedules it
 * references, so both simulation engines tax a state identically.
 *
 * The output goes through rustfmt, which CI checks separately: emitting
 * anything else would leave a file that fails one check or the other whichever
 * way it is written. Needs rustfmt on PATH.
 *
 * Usage: node scripts/gen-rust-state-tax.mjs [--check]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const statePath = join(root, 'apps/web/src/data/state-tax.ts');
const bracketPath = join(root, 'apps/web/src/data/tax-brackets-2025.ts');
const rsPath = join(root, 'rust-simulation-service/src/simulation/state_tax.rs');
const checkOnly = process.argv.includes('--check');

const FILING_STATUSES = [
  'Single',
  'MarriedFilingJointly',
  'MarriedFilingSeparately',
  'HeadOfHousehold',
];

const stateSource = readFileSync(statePath, 'utf8');
const bracketSource = readFileSync(bracketPath, 'utf8');

/** Pull one `export const NAME = { ... };` body out of a module. */
function constBody(source, name, file) {
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`Unbalanced braces reading ${name} from ${file}`);
}

/** `Single: [ { min, max, rate }, ... ]` for every filing status. */
function parseBrackets(name) {
  const body = constBody(bracketSource, name, bracketPath);
  const table = {};
  for (const status of FILING_STATUSES) {
    const at = body.indexOf(`${status}: [`);
    if (at < 0) throw new Error(`${name} is missing ${status}`);
    const end = body.indexOf(']', at);
    const rowRe = /\{\s*min:\s*(-?[\d_.]+),\s*max:\s*(null|-?[\d_.]+),\s*rate:\s*(-?[\d_.]+)\s*\}/g;
    const rows = [];
    let m;
    while ((m = rowRe.exec(body.slice(at, end)))) {
      rows.push({
        min: Number(m[1].replace(/_/g, '')),
        max: m[2] === 'null' ? null : Number(m[2].replace(/_/g, '')),
        rate: Number(m[3].replace(/_/g, '')),
      });
    }
    if (rows.length === 0) throw new Error(`${name}.${status} parsed to zero brackets`);
    let previousMax = 0;
    for (const [index, row] of rows.entries()) {
      if (!Number.isFinite(row.min) || !Number.isFinite(row.rate)) {
        throw new Error(`${name}.${status} row ${index} is not numeric`);
      }
      if (row.min !== previousMax) {
        throw new Error(
          `${name}.${status} row ${index} starts at ${row.min}, leaving a gap after ${previousMax}`,
        );
      }
      if (row.max !== null && row.max <= row.min) {
        throw new Error(`${name}.${status} row ${index} does not ascend`);
      }
      previousMax = row.max ?? Infinity;
    }
    if (rows[rows.length - 1].max !== null) {
      throw new Error(`${name}.${status} does not end in an open top bracket`);
    }
    table[status] = rows;
  }
  return table;
}

function parseDeductions(name) {
  const body = constBody(bracketSource, name, bracketPath);
  const table = {};
  for (const status of FILING_STATUSES) {
    const m = new RegExp(`${status}:\\s*([\\d_.]+)`).exec(body);
    if (!m) throw new Error(`${name} is missing ${status}`);
    table[status] = Number(m[1].replace(/_/g, ''));
  }
  return table;
}

const STATUS_VARIANT = {
  'modeled': 'Modeled',
  'no-income-tax': 'NoIncomeTax',
  'not-modeled': 'NotModeled',
};

const stateBody = constBody(stateSource, 'STATE_TAX', statePath);
const entryRe = /(\w+):\s*\{([^{}]*)\}/g;
const states = [];
let entry;
while ((entry = entryRe.exec(stateBody))) {
  const [, key, body] = entry;
  const field = (name) => {
    const m = new RegExp(`${name}:\\s*([^,\\n]+)`).exec(body);
    if (!m) throw new Error(`State ${key} is missing ${name}`);
    return m[1].trim().replace(/^'|'$/g, '');
  };
  const status = field('status');
  if (!STATUS_VARIANT[status]) throw new Error(`State ${key} has unknown status '${status}'`);
  const bracketsRef = field('brackets');
  const deductionRef = field('standardDeduction');
  if ((bracketsRef === 'null') !== (deductionRef === 'null')) {
    throw new Error(`State ${key} has brackets without a standard deduction, or the reverse`);
  }
  if ((status === 'modeled') !== (bracketsRef !== 'null')) {
    throw new Error(`State ${key} is '${status}' but ${bracketsRef === 'null' ? 'has no' : 'has'} brackets`);
  }
  states.push({
    key,
    name: field('name'),
    status,
    socialSecurity: field('socialSecurity'),
    conformsToFederalHSA: field('conformsToFederalHSA') === 'true',
    brackets: bracketsRef === 'null' ? null : parseBrackets(bracketsRef),
    deductions: deductionRef === 'null' ? null : parseDeductions(deductionRef),
  });
}
if (states.length === 0) throw new Error(`Parsed no states from ${statePath}`);
if (!states.some((state) => state.status === 'modeled')) {
  throw new Error(`No state in ${statePath} is modeled — parser or data problem`);
}

const num = (value) => (Number.isInteger(value) ? `${value}.0` : `${value}`);

function bracketArms(states) {
  return states
    .filter((state) => state.brackets)
    .map((state) => {
      const arms = FILING_STATUSES.map((status) => {
        const rows = state.brackets[status]
          .map((row) => `                TaxBracket { min: ${num(row.min)}, max: ${
            row.max === null ? 'None' : `Some(${num(row.max)})`
          }, rate: ${row.rate} },`)
          .join('\n');
        return `            FilingStatus::${status} => vec![\n${rows}\n            ],`;
      }).join('\n');
      return `        State::${state.key} => Some(match filing_status {\n${arms}\n        }),`;
    })
    .join('\n');
}

function deductionArms(states) {
  return states
    .filter((state) => state.deductions)
    .map((state) => {
      const arms = FILING_STATUSES
        .map((status) => `            FilingStatus::${status} => ${num(state.deductions[status])},`)
        .join('\n');
      return `        State::${state.key} => Some(match filing_status {\n${arms}\n        }),`;
    })
    .join('\n');
}

const profileArms = states
  .map((state) => `        State::${state.key} => StateTaxProfile {
            name: "${state.name}",
            status: StateTaxStatus::${STATUS_VARIANT[state.status]},
            social_security_exempt: ${state.socialSecurity === 'exempt'},
            conforms_to_federal_hsa: ${state.conformsToFederalHSA},
        },`)
  .join('\n');

const generated = `// This file is generated; do not edit it by hand.
// The source of truth is apps/web/src/data/state-tax.ts.
// Regenerate it with: node scripts/gen-rust-state-tax.mjs
//
// State income tax as data. A state with no income tax and a state nobody has
// modeled yet both produce zero tax; \`status\` is what tells them apart.

use crate::simulation::tax::TaxBracket;
use crate::types::{FilingStatus, State};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateTaxStatus {
    Modeled,
    NoIncomeTax,
    NotModeled,
}

#[derive(Debug, Clone)]
pub struct StateTaxProfile {
    // Name and status exist so this table stays a faithful copy of the
    // TypeScript one. Nothing in the service reads them.
    #[allow(dead_code)]
    pub name: &'static str,
    #[allow(dead_code)]
    pub status: StateTaxStatus,
    pub social_security_exempt: bool,
    /// California allows no deduction for HSA contributions; most states do.
    pub conforms_to_federal_hsa: bool,
}

pub fn state_tax_profile(state: &State) -> StateTaxProfile {
    match state {
${profileArms}
    }
}

pub fn state_brackets(state: &State, filing_status: &FilingStatus) -> Option<Vec<TaxBracket>> {
    match state {
${bracketArms(states)}
        _ => None,
    }
}

pub fn state_standard_deduction(state: &State, filing_status: &FilingStatus) -> Option<f64> {
    match state {
${deductionArms(states)}
        _ => None,
    }
}
`;

const formatted = (() => {
  try {
    return execFileSync('rustfmt', ['--emit', 'stdout', '--edition', '2021'], {
      input: generated,
      encoding: 'utf8',
    });
  } catch (error) {
    throw new Error(`rustfmt failed; is it on PATH? (${error.message})`);
  }
})();

const existing = (() => {
  try {
    return readFileSync(rsPath, 'utf8');
  } catch {
    return null;
  }
})();

if (checkOnly) {
  if (existing !== formatted) {
    console.error(`${rsPath} is stale. Run: node scripts/gen-rust-state-tax.mjs`);
    process.exit(1);
  }
  console.log(`state_tax.rs is up to date (${states.length} states).`);
} else {
  writeFileSync(rsPath, formatted);
  console.log(`Wrote ${rsPath} (${states.length} states).`);
}
