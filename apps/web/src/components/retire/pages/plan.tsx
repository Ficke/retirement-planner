"use client";

import { useMemo } from 'react';
import { usePlan } from '@/state/usePlan';
import type { FilingStatus, State } from '@/domain/types';
import { calculateTax } from '@/engine/tax';
import { Card } from '../primitives';
import { fmtCurrency, fmtPercent } from '../format';

const STATE_OPTIONS: [State, string][] = [
  ['CA', 'California'], ['TX', 'Texas'], ['FL', 'Florida'],
  ['NY', 'New York'], ['WA', 'Washington'], ['Other', 'Other'],
];

const FILING_OPTIONS: [FilingStatus, string][] = [
  ['Single', 'Single'],
  ['MarriedFilingJointly', 'Married Filing Jointly'],
  ['MarriedFilingSeparately', 'Married Filing Separately'],
  ['HeadOfHousehold', 'Head of Household'],
];

export function PagePlan() {
  const { plan, updatePlan } = usePlan();
  const updateProfile = (profile: Parameters<typeof updatePlan>[0]['profile']) => updatePlan({ profile });
  const p = plan.profile;

  const tax = useMemo(() => {
    try {
      return calculateTax(p.currentSalary, 0, p.age, p.filingStatus, p.state, p.desiredSpending);
    } catch {
      return null;
    }
  }, [p.currentSalary, p.age, p.filingStatus, p.state, p.desiredSpending]);

  const totalTax = tax?.totalTax ?? 0;
  const effRate = tax?.effectiveRate ?? 0;
  const takeHome = p.currentSalary - totalTax;
  const available = takeHome - p.desiredSpending;
  const availableRate = p.currentSalary > 0 ? available / p.currentSalary : 0;
  const spendOfGross = p.currentSalary > 0 ? p.desiredSpending / p.currentSalary : 0;

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Profile</h1>
          <div className="sub">Facts about you. Auto-saves on change.</div>
        </div>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <Field label="Current age" type="number"
                 value={p.age} onChange={v => updateProfile({ age: Number(v) })} />
          <Field label="Life expectancy" type="number"
                 value={p.lifeExpectancy} onChange={v => updateProfile({ lifeExpectancy: Number(v) })} />
          <Field label="As-of date" type="date"
                 value={p.asOfDate} onChange={v => updateProfile({ asOfDate: String(v) })} />
          <SelectField label="State" value={p.state} options={STATE_OPTIONS}
                       onChange={v => updateProfile({ state: v as State })} />
          <SelectField label="Filing status" value={p.filingStatus} options={FILING_OPTIONS}
                       onChange={v => updateProfile({ filingStatus: v as FilingStatus })} />
          <Field label="Retirement age" type="number"
                 value={p.retirementAge} onChange={v => updateProfile({ retirementAge: Number(v) })} />
          <Field label="Current salary" type="currency"
                 value={p.currentSalary} onChange={v => updateProfile({ currentSalary: Number(v) })} />
          <Field label="Desired retirement spending (annual)" type="currency"
                 value={p.desiredSpending} onChange={v => updateProfile({ desiredSpending: Number(v) })} />
          <Field label="Salary growth (real %)" type="number" step={0.1}
                 value={(p.salaryGrowthRate * 100).toFixed(1)}
                 onChange={v => updateProfile({ salaryGrowthRate: Number(v) / 100 })} />
        </div>
      </Card>

      <div className="r-section-title"><h2>Tax &amp; Savings</h2></div>
      <Card flush>
        <table className="r-tbl">
          <thead><tr><th>Flow</th><th className="r">Annual</th><th className="r">% of Gross</th></tr></thead>
          <tbody>
            <Row a="Gross salary" b={fmtCurrency(p.currentSalary)} c="100%" strong />
            <Row a={`− Estimated taxes (federal + state + FICA)`} b={`-${fmtCurrency(totalTax)}`} c={fmtPercent(effRate, 1)} tone="neg" indent />
            <Row a="Take-home pay" b={fmtCurrency(takeHome)} c={fmtPercent(p.currentSalary > 0 ? takeHome / p.currentSalary : 0, 1)} strong />
            <Row a="− Annual spending" b={`-${fmtCurrency(p.desiredSpending)}`} c={fmtPercent(spendOfGross, 1)} tone="neg" indent />
            <Row a="Available for savings" b={fmtCurrency(available)} c={fmtPercent(availableRate, 1)} strong />
          </tbody>
        </table>
        <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--r-ink-3)', borderTop: '1px solid var(--r-line)', background: 'var(--r-bg-sunk)' }}>
          Taxes derived from {p.state === 'CA' ? 'Federal + California 2025' : 'Federal 2025'} brackets and FICA. Per-bucket allocation (401k / HSA / Roth / Taxable) is determined automatically by the simulation engine using current contribution limits.
        </div>
      </Card>
    </>
  );
}

function Field({
  label, value, onChange, type = 'text', step,
}: {
  label: string;
  value: string | number;
  onChange: (v: string | number) => void;
  type?: 'text' | 'number' | 'date' | 'currency';
  step?: number;
}) {
  if (type === 'currency') {
    const display = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);
    return (
      <div className="r-field">
        <label>{label}</label>
        <input
          className="r-input mono"
          type="text"
          defaultValue={display}
          onBlur={e => {
            const n = Number(e.target.value.replace(/[^0-9.-]/g, ''));
            if (!isNaN(n)) onChange(n);
          }}
        />
      </div>
    );
  }
  return (
    <div className="r-field">
      <label>{label}</label>
      <input
        className="r-input"
        type={type}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function SelectField<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="r-field">
      <label>{label}</label>
      <select className="r-select" value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function Row({
  a, b, c, tone, strong, indent,
}: {
  a: string; b: string; c: string;
  tone?: 'neg' | 'info';
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <tr style={strong ? { background: 'var(--r-bg-sunk)' } : undefined}>
      <td style={{ paddingLeft: indent ? 32 : 14, color: tone === 'neg' ? 'var(--r-neg)' : tone === 'info' ? 'var(--r-ink-2)' : 'var(--r-ink)', fontWeight: strong ? 600 : 400 }}>{a}</td>
      <td className={`r mono ${tone === 'neg' ? 'r-neg' : ''}`} style={{ fontWeight: strong ? 600 : 400 }}>{b}</td>
      <td className="r mono" style={{ color: 'var(--r-ink-3)' }}>{c}</td>
    </tr>
  );
}
