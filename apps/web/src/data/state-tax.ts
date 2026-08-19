/**
 * State income tax, as data rather than branches.
 *
 * The engines read a profile from this table instead of testing which state a
 * plan is in, so adding a state is an entry here plus a member on `State` —
 * the compiler requires both — and no engine change at all.
 *
 * Three dimensions are deliberately absent until a modeled state needs them:
 * retirement-income exclusions (New York excludes the first $20,000 of pension
 * and IRA distributions at 59½), separate capital-gains regimes (Washington
 * taxes gains above roughly $270,000 at 7% while having no income tax), and
 * local income tax (New York City, and municipalities in Ohio and Pennsylvania).
 */

import type { FilingStatus, State, TaxBracket } from '@/domain/types';
import {
  CA_TAX_BRACKETS_2025,
  CA_STANDARD_DEDUCTIONS_2025,
} from '@/data/tax-brackets-2025';

/**
 * Whether a plan in this state gets a real answer. `not-modeled` is a first
 * class value, not an absence — the UI reads it to say so rather than quietly
 * reporting zero.
 */
export type StateTaxStatus = 'modeled' | 'no-income-tax' | 'not-modeled';

export interface StateTaxProfile {
  name: string;
  status: StateTaxStatus;
  brackets: Record<FilingStatus, TaxBracket[]> | null;
  standardDeduction: Record<FilingStatus, number> | null;
  socialSecurity: 'exempt' | 'taxable';
  capitalGains: 'ordinary';
  /** California allows no deduction for HSA contributions; most states do. */
  conformsToFederalHSA: boolean;
}

/**
 * Written out per state rather than spread from shared shapes: this table is
 * the source the Rust engine's copy is generated from, and the generator reads
 * it as text.
 */
export const STATE_TAX: Record<State, StateTaxProfile> = {
  CA: {
    name: 'California',
    status: 'modeled',
    brackets: CA_TAX_BRACKETS_2025,
    standardDeduction: CA_STANDARD_DEDUCTIONS_2025,
    socialSecurity: 'exempt',
    capitalGains: 'ordinary',
    conformsToFederalHSA: false,
  },
  TX: {
    name: 'Texas',
    status: 'no-income-tax',
    brackets: null,
    standardDeduction: null,
    socialSecurity: 'exempt',
    capitalGains: 'ordinary',
    conformsToFederalHSA: true,
  },
  FL: {
    name: 'Florida',
    status: 'no-income-tax',
    brackets: null,
    standardDeduction: null,
    socialSecurity: 'exempt',
    capitalGains: 'ordinary',
    conformsToFederalHSA: true,
  },
  WA: {
    name: 'Washington',
    status: 'no-income-tax',
    brackets: null,
    standardDeduction: null,
    socialSecurity: 'exempt',
    capitalGains: 'ordinary',
    conformsToFederalHSA: true,
  },
  NY: {
    name: 'New York',
    status: 'not-modeled',
    brackets: null,
    standardDeduction: null,
    socialSecurity: 'exempt',
    capitalGains: 'ordinary',
    conformsToFederalHSA: true,
  },
  Other: {
    name: 'Other',
    status: 'not-modeled',
    brackets: null,
    standardDeduction: null,
    socialSecurity: 'exempt',
    capitalGains: 'ordinary',
    conformsToFederalHSA: true,
  },
};

export function stateTaxProfileOf(state: State): StateTaxProfile {
  return STATE_TAX[state] ?? STATE_TAX.Other;
}
