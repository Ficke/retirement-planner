"use client";

import { useMemo, useState } from 'react';
import { usePlan } from '@/state/usePlan';
import presets from '@/data/cma/presets.json';
import { Card, Chip, Toggle } from '../primitives';
import { IncomeSourcesChart, PercentileBars, ProbabilityRing, WealthFanChart } from '../charts';
import { fmtCurrency } from '../format';

type ChartView = 'wealth' | 'income' | 'percentiles';
type YearFilter = 'all' | 'work' | 'retired';

type PresetEntry = { stocks: { mean: number; vol: number }; bonds: { mean: number; vol: number }; inflation: { mean: number; vol: number } };
const PRESETS = presets as unknown as Record<string, PresetEntry>;

export function PageProjections() {
  const plan = usePlan(s => s.plan);
  const result = usePlan(s => s.simulationResult);
  const isSimulating = usePlan(s => s.isSimulatingMain);

  const [view, setView] = useState<ChartView>('wealth');
  const [yearFilter, setYearFilter] = useState<YearFilter>('all');

  const yearly = result?.yearlyProjections ?? [];
  const filteredYears = useMemo(() => {
    if (yearFilter === 'work') return yearly.filter(p => !p.isRetired);
    if (yearFilter === 'retired') return yearly.filter(p => p.isRetired);
    return yearly;
  }, [yearly, yearFilter]);

  // Derived from active preset + portfolio allocation
  const presetKey = (plan.assumptions.preset ?? 'Moderate') as keyof typeof PRESETS;
  const cma = PRESETS[presetKey] ?? PRESETS.Moderate;
  const stockWeight = plan.accounts.length
    ? plan.accounts.reduce((s, a) => s + (a.balance * a.assetWeights.stocks), 0) /
      Math.max(1, plan.accounts.reduce((s, a) => s + a.balance, 0))
    : 0.6;
  const bondWeight = 1 - stockWeight;
  const expectedReturn = (cma.stocks.mean * stockWeight + cma.bonds.mean * bondWeight) * 100;
  const expectedVol = Math.sqrt(
    Math.pow(cma.stocks.vol * stockWeight, 2) + Math.pow(cma.bonds.vol * bondWeight, 2)
  ) * 100;
  const horizon = plan.profile.lifeExpectancy - plan.profile.age;

  const successProb = result?.successProbability ?? 0;
  const median = result?.medianTerminalWealth ?? 0;
  const p10 = result?.percentile10TerminalWealth ?? 0;
  const p90 = result?.percentile90TerminalWealth ?? 0;

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Projections</h1>
          <div className="sub">
            Monte Carlo simulation from age {plan.profile.age} to {plan.profile.lifeExpectancy}.
          </div>
        </div>
        <div className="right">
          <Chip dot={isSimulating ? 'var(--r-warn)' : 'var(--r-pos)'}>
            {isSimulating ? 'Recalculating' : 'Up to date'}
          </Chip>
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 0, background: 'var(--r-bg-sunk)',
        border: '1px solid var(--r-line)', borderRadius: 8, padding: '10px 14px',
        alignItems: 'center', fontSize: 11.5, color: 'var(--r-ink-3)', flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: 14 }}>Model</span>
        <Derived label="Expected return" value={expectedReturn.toFixed(1) + '%'} />
        <Derived label="Expected volatility" value={expectedVol.toFixed(1) + '%'} />
        <Derived label="Inflation" value={(cma.inflation.mean * 100).toFixed(1) + '%'} />
        <Derived label="Horizon" value={`${horizon} yrs`} />
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Derived from Assumptions</span>
      </div>

      <div className="r-kpi-row">
        <div className="r-kpi hero">
          <div className="r-kpi-label">Success Probability</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <ProbabilityRing value={successProb} size={96} thickness={8} />
            <div className="r-prob-meter" style={{ flex: 1, height: 6 }}>
              <span style={{ width: (successProb * 100) + '%' }} />
            </div>
          </div>
        </div>
        <div className="r-kpi">
          <div className="r-kpi-label">Median Terminal Wealth</div>
          <div className="r-kpi-value">{fmtCurrency(median, true)}</div>
          <div className="r-kpi-delta"><span>at age {plan.profile.lifeExpectancy}</span></div>
        </div>
        <div className="r-kpi">
          <div className="r-kpi-label">P10 (worst 10%)</div>
          <div className="r-kpi-value">{fmtCurrency(p10, true)}</div>
          <div className="r-kpi-delta"><span>downside scenario</span></div>
        </div>
        <div className="r-kpi">
          <div className="r-kpi-label">P90 (best 10%)</div>
          <div className="r-kpi-value">{fmtCurrency(p90, true)}</div>
          <div className="r-kpi-delta"><span>upside scenario</span></div>
        </div>
      </div>

      <Card title="Outcome Distribution" sub="Projected portfolio value across percentiles"
            actions={
              <Toggle<ChartView> value={view} onChange={setView} options={[
                { value: 'wealth', label: 'Trajectory' },
                { value: 'income', label: 'Income sources' },
                { value: 'percentiles', label: 'Percentiles' },
              ]} />
            }>
        {!yearly.length ? (
          <div className="r-empty" style={{ height: 340 }}>
            {isSimulating ? 'Running simulation…' : 'No projection data — adjust your plan to run.'}
          </div>
        ) : view === 'wealth' ? (
          <WealthFanChart projections={yearly} retirementAge={plan.profile.retirementAge} height={340} />
        ) : view === 'income' ? (
          <IncomeSourcesChart projections={yearly} height={300} />
        ) : (
          <div style={{ padding: '24px 16px' }}><PercentileBars projections={yearly} /></div>
        )}
      </Card>

      <div className="r-section-title">
        <h2>Year-by-Year</h2>
        <Toggle<YearFilter> value={yearFilter} onChange={setYearFilter} options={[
          { value: 'all', label: 'All years' },
          { value: 'work', label: 'Working' },
          { value: 'retired', label: 'Retired' },
        ]} />
      </div>
      <Card flush>
        <div style={{ maxHeight: 480, overflow: 'auto' }}>
          <table className="r-tbl">
            <thead>
              <tr>
                <th>Age</th>
                <th>Phase</th>
                <th className="r">Income</th>
                <th className="r">Spending</th>
                <th className="r">Taxes</th>
                <th className="r">Net Saved</th>
                <th className="r">Portfolio</th>
                <th className="r">P10 / P90</th>
              </tr>
            </thead>
            <tbody>
              {filteredYears.length === 0 ? (
                <tr><td colSpan={8} className="r-empty">No years in this filter.</td></tr>
              ) : filteredYears.map(p => {
                const externalIncome = p.income + p.socialSecurityBenefit;
                return (
                  <tr key={p.age}>
                    <td className="mono" style={{ fontWeight: 600 }}>{p.age}</td>
                    <td>
                      <Chip tone={p.isRetired ? 'info' : 'pos'} dot={p.isRetired ? 'var(--r-info)' : 'var(--r-pos)'}>
                        {p.isRetired ? 'Retired' : 'Working'}
                      </Chip>
                    </td>
                    <td className="r mono">{fmtCurrency(externalIncome, true)}</td>
                    <td className="r mono r-neg">−{fmtCurrency(p.spending, true)}</td>
                    <td className="r mono r-neg">−{fmtCurrency(p.taxes, true)}</td>
                    <td className={`r mono ${p.savings >= 0 ? 'r-pos' : 'r-neg'}`}>
                      {p.savings >= 0 ? '+' : ''}{fmtCurrency(p.savings, true)}
                    </td>
                    <td className="r mono" style={{ fontWeight: 600 }}>{fmtCurrency(p.portfolioValue, true)}</td>
                    <td className="r mono" style={{ color: 'var(--r-ink-3)', fontSize: 11.5 }}>
                      {fmtCurrency(p.p10, true)} / {fmtCurrency(p.p90, true)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Derived({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, marginRight: 22 }}>
      <span>{label}</span>
      <span className="mono" style={{ color: 'var(--r-ink)', fontWeight: 600, fontSize: 12.5 }}>{value}</span>
    </span>
  );
}
