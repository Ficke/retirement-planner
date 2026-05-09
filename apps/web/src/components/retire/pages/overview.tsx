"use client";

import { usePlan, usePlanSelectors } from '@/state/usePlan';
import { Card, KPI, Sparkline, SliderField } from '../primitives';
import { Donut, ProbabilityRing, WealthFanChart } from '../charts';
import { fmtCurrency, fmtPercent } from '../format';

const KIND_COLOR: Record<string, { label: string; color: string }> = {
  Taxable: { label: 'Taxable', color: 'var(--r-c-taxable)' },
  Traditional: { label: 'Traditional', color: 'var(--r-c-traditional)' },
  Roth: { label: 'Roth', color: 'var(--r-c-roth)' },
  HSA: { label: 'HSA', color: 'var(--r-c-hsa)' },
};

export function PageOverview() {
  const plan = usePlan(s => s.plan);
  const result = usePlan(s => s.simulationResult);
  const updatePlan = usePlan(s => s.updatePlan);
  const accountsWithHoldings = usePlanSelectors.useAccountsWithHoldings();

  const netWorth = accountsWithHoldings.reduce((s, a) => s + (a.currentBalance || 0), 0);
  const yearsToRetire = Math.max(0, plan.profile.retirementAge - plan.profile.age);
  const retirementYear = new Date().getFullYear() + yearsToRetire;
  const successProb = result?.successProbability ?? 0;

  const sparkData = (result?.yearlyProjections ?? [])
    .slice(0, 24)
    .map(p => p.p50);

  const byKind: Record<string, number> = {};
  for (const a of accountsWithHoldings) {
    const k = a.account.type;
    byKind[k] = (byKind[k] || 0) + (a.currentBalance || 0);
  }
  const allocData = Object.entries(byKind).map(([k, v]) => ({
    label: KIND_COLOR[k]?.label ?? k,
    value: v,
    color: KIND_COLOR[k]?.color ?? 'var(--r-ink-3)',
  }));

  const monthlySpend = plan.profile.desiredSpending / 12;
  const spendOfSalary = plan.profile.currentSalary > 0
    ? plan.profile.desiredSpending / plan.profile.currentSalary
    : 0;
  const successLabel = successProb >= 0.85 ? 'Excellent' : successProb >= 0.7 ? 'On track' : successProb >= 0.5 ? 'At risk' : 'Off track';

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Overview</h1>
          <div className="sub">
            As of {new Date(plan.profile.asOfDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div className="r-kpi-row" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr' }}>
        <div className="r-kpi hero">
          <div className="r-kpi-label">Plan Health</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ProbabilityRing value={successProb} size={108} thickness={9} />
            <div style={{ flex: 1 }}>
              <div className="r-kpi-value" style={{ fontSize: 19, marginBottom: 4 }}>{successLabel}</div>
              <div style={{ fontSize: 11.5, color: 'var(--r-ink-3)', lineHeight: 1.5 }}>
                {(successProb * 100).toFixed(0)}% of simulated paths fund your full retirement.
              </div>
            </div>
          </div>
        </div>
        <KPI label="Net Worth" value={fmtCurrency(netWorth, true)} sub="across all accounts">
          {sparkData.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Sparkline data={sparkData} color="var(--r-accent)" />
            </div>
          )}
        </KPI>
        <KPI
          label="Retirement Date"
          value={String(retirementYear)}
          sub={`Age ${plan.profile.retirementAge} · ${yearsToRetire} years away`}
        />
        <KPI
          label="Monthly Spending"
          value={fmtCurrency(monthlySpend, false).replace('.00', '')}
          sub={`${fmtPercent(spendOfSalary, 0)} of gross salary today`}
        />
      </div>

      <Card title="Tweak the levers" sub="Sliders update your plan and re-run the simulation.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28 }}>
          <SliderField
            label="Retirement age"
            value={plan.profile.retirementAge}
            min={50} max={75}
            onChange={v => updatePlan({ profile: { retirementAge: v } })}
            format={v => `Age ${v}`}
          />
          <SliderField
            label="Annual spending in retirement"
            value={plan.profile.desiredSpending}
            min={20000} max={200000} step={1000}
            onChange={v => updatePlan({ profile: { desiredSpending: v } })}
            format={v => fmtCurrency(v)}
          />
          <SliderField
            label="Claim Social Security at"
            value={plan.socialSecurity.claimAge}
            min={62} max={70}
            onChange={v => updatePlan({ socialSecurity: { claimAge: v } })}
            format={v => `Age ${v}`}
          />
        </div>
      </Card>

      <div className="r-split-2">
        <Card title="Wealth Trajectory" sub="Median path with 25–75 and 10–90 percentile bands.">
          {result?.yearlyProjections?.length ? (
            <WealthFanChart projections={result.yearlyProjections} retirementAge={plan.profile.retirementAge} height={260} />
          ) : (
            <div className="r-empty" style={{ height: 260 }}>Running simulation…</div>
          )}
        </Card>

        <Card title="Allocation by Account Type" sub="Across all accounts">
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Donut
              data={allocData}
              size={132}
              thickness={18}
              centerLabel="Total"
              centerValue={fmtCurrency(netWorth, true)}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allocData.length === 0 && <div style={{ color: 'var(--r-ink-3)', fontSize: 12 }}>No accounts yet.</div>}
              {allocData.map(a => (
                <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                  <span className="r-dot" style={{ background: a.color, width: 9, height: 9 }} />
                  <span style={{ flex: 1 }}>{a.label}</span>
                  <span className="mono" style={{ color: 'var(--r-ink-2)' }}>{fmtCurrency(a.value, true)}</span>
                  <span className="mono" style={{ color: 'var(--r-ink-3)', minWidth: 40, textAlign: 'right' }}>
                    {netWorth > 0 ? ((a.value / netWorth) * 100).toFixed(0) : '0'}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
