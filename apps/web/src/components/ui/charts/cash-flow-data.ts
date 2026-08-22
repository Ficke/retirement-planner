import type { OutcomeCashFlowRow } from "@/domain/types";

export type CashFlowRow = Record<string, number> & { age: number };

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
 * One plotted row per modeled year, holding both stacks and the money-in line.
 *
 * The panels only mean anything together: money in less money out is the
 * year's saving, which the chart draws as the space under the line rather than
 * as a band. `toCashFlowRows` is where that has to stay true, so it is kept
 * apart from the component and covered directly.
 */
export function toCashFlowRows(projections: OutcomeCashFlowRow[]): CashFlowRow[] {
  return projections.map((row) => {
    const drawn = netWithdrawals(row);
    const salary = row.isRetired ? 0 : row.income;
    // New engines report funded healthcare, capped on each path before cohort
    // averaging. Keep this cap for a partially rolled-out cloud engine and the
    // nullish guard for an engine deployed before the field existed.
    const healthcare = Math.min(row.healthcareCost ?? 0, row.spending);
    return {
      age: row.age,
      salary,
      socialSecurity: row.socialSecurityBenefit,
      ...drawn,
      living: row.spending - healthcare,
      healthcare,
      tax: row.taxes,
      moneyIn: salary + row.socialSecurityBenefit + drawn.portfolio,
      saved: Math.max(0, row.savings),
    };
  });
}
