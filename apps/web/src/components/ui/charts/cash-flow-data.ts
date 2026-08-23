import type { OutcomeCashFlowRow } from "@/domain/types";

export type CashFlowRow = Record<string, number> & { age: number };

function annualize(row: OutcomeCashFlowRow, multiplier: number): OutcomeCashFlowRow {
  return {
    ...row,
    income: row.income * multiplier,
    spending: row.spending * multiplier,
    taxes: row.taxes * multiplier,
    savings: row.savings * multiplier,
    socialSecurityBenefit: row.socialSecurityBenefit * multiplier,
    withdrawalTaxable: row.withdrawalTaxable * multiplier,
    withdrawalTraditional: row.withdrawalTraditional * multiplier,
    withdrawalRoth: row.withdrawalRoth * multiplier,
    withdrawalHSA: row.withdrawalHSA * multiplier,
    healthcareCost: row.healthcareCost == null
      ? row.healthcareCost
      : row.healthcareCost * multiplier,
    longTermCareCost: row.longTermCareCost == null
      ? row.longTermCareCost
      : row.longTermCareCost * multiplier,
  };
}

/**
 * A required distribution the year did not need is withdrawn and paid straight
 * back into the taxable bucket. It never reaches the household, and at the ages
 * where RMDs are large it is most of the gross draw, so leaving it in would let
 * an account transfer bury the spending the chart exists to show. Its tax
 * still lands on the outflow side, which is the part the plan actually feels.
 *
 * Draining Traditional first is where a required distribution comes from.
 */
function netWithdrawals(row: OutcomeCashFlowRow) {
  const drawn = {
    fromTraditional: row.withdrawalTraditional,
    fromTaxable: row.withdrawalTaxable,
    fromRoth: row.withdrawalRoth,
    fromHSA: row.withdrawalHSA,
  };
  const gross = Object.values(drawn).reduce((sum, value) => sum + value, 0);
  let reinvested = Math.max(0, gross - Math.max(0, -row.savings));
  for (const key of Object.keys(drawn) as (keyof typeof drawn)[]) {
    const applied = Math.min(reinvested, drawn[key]);
    drawn[key] -= applied;
    reinvested -= applied;
  }
  const portfolio = Object.values(drawn).reduce((sum, value) => sum + value, 0);
  return { ...drawn, portfolio };
}

/**
 * One plotted row per modeled year, holding both cash-flow stacks.
 *
 * `toCashFlowRows` keeps the account-transfer netting and spending breakdown
 * apart from the component so their cash reconciliation can be tested directly.
 */
export function toCashFlowRows(
  projections: OutcomeCashFlowRow[],
  partialYear?: { age: number; fraction: number },
): CashFlowRow[] {
  return projections.map((projection) => {
    const multiplier = partialYear?.age === projection.age
      && partialYear.fraction > 0
      && partialYear.fraction <= 1
      ? 1 / partialYear.fraction
      : 1;
    const row = multiplier === 1 ? projection : annualize(projection, multiplier);
    const drawn = netWithdrawals(row);
    const salary = row.isRetired ? 0 : row.income;
    // New engines split funded care before cohort averaging. Preserve their
    // proportions if a partially rolled-out response exceeds funded spending,
    // and keep nullish guards for engines deployed before either result field.
    const reportedHealthcare = Math.max(0, row.healthcareCost ?? 0);
    const reportedLongTermCare = Math.max(0, row.longTermCareCost ?? 0);
    const reportedCare = reportedHealthcare + reportedLongTermCare;
    const fundedCare = Math.min(reportedCare, Math.max(0, row.spending));
    const fundedShare = reportedCare > 0 ? fundedCare / reportedCare : 0;
    const healthcare = reportedHealthcare * fundedShare;
    const longTermCare = reportedLongTermCare * fundedShare;
    return {
      age: row.age,
      salary,
      socialSecurity: row.socialSecurityBenefit,
      ...drawn,
      living: row.spending - healthcare - longTermCare,
      healthcare,
      longTermCare,
      tax: row.taxes,
    };
  });
}
