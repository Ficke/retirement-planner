import { describe, expect, it } from 'vitest';
import { projectScenario } from '@/engine/projection';
import { calculateRetirementTax, householdOf } from '@/engine/tax';
import { FEDERAL_TAX_BRACKETS_2025 } from '@/data/tax-brackets-2025';
import { irmaaFreeMagiCeiling } from '@/data/healthcare-premiums';
import type { RothConversionCeiling, SimulationPlan } from '@/domain/types';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
import { toCashFlowRows } from '@/components/ui/charts/cash-flow-data';
import { createTestProjectionSettings } from '../test-helpers';

const RETIREMENT_AGE = 65;
/** Born 1960 or later, so RMDs wait until 75 and the window is ten years long. */
const RMD_AGE = 75;

function planWith(
  rothConversion: { enabled: boolean; ceiling: RothConversionCeiling },
): SimulationPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    profile: {
      birthDate: '1960-01-01',
      asOfDate: '2025-01-01',
      currentSalary: 0,
      salaryGrowthRate: 0,
      retirementAge: RETIREMENT_AGE,
      lifeExpectancy: 95,
      currentSpending: 80_000,
      workingSpendingGrowthRate: 0,
      retirementSpending: 80_000,
      retirementSpendingGrowthRate: 0,
      retirementHealthcare: {
        preMedicarePremium: 0,
        medicarePremium: 0,
        outOfPocket: 0,
        realGrowthRate: 0,
      },
      filingStatus: 'Single',
      state: 'CA',
    },
    accounts: [
      { type: 'Traditional', balance: 3_000_000, assetWeights: { stocks: 0.6, bonds: 0.4 } },
      { type: 'Taxable', balance: 800_000, assetWeights: { stocks: 0.7, bonds: 0.3 } },
    ],
    socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
    assumptions: createTestProjectionSettings({ rothConversion }),
  };
}

const config = { paths: 1, seed: 42 };

describe('Roth conversions', () => {
  it('converts nothing when the policy is off', () => {
    const { projections } = projectScenario(planWith({ enabled: false, ceiling: 'bracket24' }), config);
    expect(projections.every((year) => year.rothConversion === 0)).toBe(true);
  });

  it('converts only between retirement and the year before RMDs begin', () => {
    const { projections } = projectScenario(planWith({ enabled: true, ceiling: 'bracket24' }), config);
    const converting = projections.filter((year) => year.rothConversion > 0);

    expect(converting.length).toBeGreaterThan(0);
    expect(Math.min(...converting.map((y) => y.age))).toBeGreaterThanOrEqual(RETIREMENT_AGE);
    expect(Math.max(...converting.map((y) => y.age))).toBeLessThan(RMD_AGE);
  });

  it('fills a bracket ceiling without crossing it', () => {
    const { projections } = projectScenario(planWith({ enabled: true, ceiling: 'bracket22' }), config);
    const bracketTop = FEDERAL_TAX_BRACKETS_2025.Single.find((b) => b.rate === 0.22)!.max!;

    for (const year of projections.filter((y) => y.rothConversion > 0)) {
      const { taxableIncome } = calculateRetirementTax({
        traditionalWithdrawals: year.withdrawalTraditional + year.rothConversion,
        socialSecurityBenefit: year.socialSecurityBenefit,
        qualifiedIncome: year.withdrawalTaxable * 0.5,
        household: householdOf('Single', year.age),
        state: 'CA',
        taxYear: year.year,
      });
      expect(taxableIncome).toBeLessThanOrEqual(bracketTop + 1);
      expect(taxableIncome).toBeGreaterThan(bracketTop * 0.9);
    }
  });

  it('keeps MAGI under the first surcharge tier on the IRMAA ceiling', () => {
    const { projections } = projectScenario(planWith({ enabled: true, ceiling: 'irmaaTier' }), config);
    const ceiling = irmaaFreeMagiCeiling('Single');

    for (const year of projections.filter((y) => y.rothConversion > 0)) {
      const magi = year.socialSecurityBenefit
        + year.withdrawalTraditional
        + year.rothConversion
        + year.withdrawalTaxable * 0.5;
      expect(magi).toBeLessThanOrEqual(ceiling + 1);
    }
  });

  it('leaves a smaller pre-tax balance to be forced out, and a smaller RMD', () => {
    const off = projectScenario(planWith({ enabled: false, ceiling: 'bracket24' }), config);
    const on = projectScenario(planWith({ enabled: true, ceiling: 'bracket24' }), config);

    const firstRmd = (r: typeof off) => r.projections.find((y) => y.age === RMD_AGE)!.rmdAmount;
    expect(firstRmd(on)).toBeLessThan(firstRmd(off));
  });

  it('a higher ceiling converts more', () => {
    const total = (ceiling: RothConversionCeiling) => projectScenario(
      planWith({ enabled: true, ceiling }),
      config,
    ).projections.reduce((sum, year) => sum + year.rothConversion, 0);

    expect(total('bracket24')).toBeGreaterThan(total('bracket12'));
    expect(total('bracket32')).toBeGreaterThan(total('bracket24'));
  });

  it('still reconciles the cash-flow chart in a conversion year', () => {
    const { projections } = projectScenario(planWith({ enabled: true, ceiling: 'bracket24' }), config);
    const rows = toCashFlowRows(projections.map((year) => ({ ...year, isRetired: year.isRetired })));

    const converting = rows.filter((_, index) => projections[index].rothConversion > 0);
    expect(converting.length).toBeGreaterThan(0);

    // Selling taxable to pay the conversion tax has to show up on the money-in
    // side, or the year reports tax it never raised the cash for. The dollar of
    // slack is the withdrawal solver's own convergence tolerance, which these
    // years inherit and which is there whether or not anything converts.
    for (const row of converting) {
      const moneyIn = row.salary + row.socialSecurity + row.portfolio;
      const moneyOut = row.living + row.healthcare + row.tax;
      expect(Math.abs(moneyOut - moneyIn)).toBeLessThan(1);
    }
  });

  it('leaks nothing but tax: the first conversion year costs exactly its own tax', () => {
    const off = projectScenario(planWith({ enabled: false, ceiling: 'bracket24' }), config);
    const on = projectScenario(planWith({ enabled: true, ceiling: 'bracket24' }), config);

    const first = on.projections.findIndex((year) => year.rothConversion > 0);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(on.projections[first].rothConversion).toBeGreaterThan(0);

    // A conversion moves money between buckets one for one. Up to the first
    // conversion the two runs are identical, so at the end of that year the
    // whole difference in portfolio value has to be the tax the conversion
    // added — no more, and none of the converted principal itself.
    const portfolioGap = off.projections[first].portfolioValue
      - on.projections[first].portfolioValue;
    const extraTax = on.projections[first].taxes - off.projections[first].taxes;
    expect(portfolioGap).toBeCloseTo(extraTax, 4);
  });

  it('reports terminal wealth after the tax the pre-tax balance still owes', () => {
    const off = projectScenario(planWith({ enabled: false, ceiling: 'bracket24' }), config);
    expect(off.afterTaxTerminalWealth).toBeLessThan(off.terminalWealth);
    expect(off.afterTaxTerminalWealth).toBeGreaterThan(off.terminalWealth * 0.69);
  });
});
