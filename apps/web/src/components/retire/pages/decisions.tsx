"use client";

import { useState } from 'react';
import { usePlan } from '@/state/usePlan';
import type { SimulationResult } from '@/domain/types';
import { Card, SliderField } from '../primitives';
import { fmtCurrency, fmtPercent } from '../format';

export function PageDecisions() {
  const { plan, ssAnalysisResult, spendingAnalysisResult, retirementAgeAnalysisResult, simulationResult } = usePlan();

  const baselineRetireAge = plan.profile.retirementAge;
  const baselineSpending = plan.profile.desiredSpending;
  const baselineSSAge = plan.socialSecurity.claimAge;
  const baselineSuccess = simulationResult?.successProbability ?? 0;
  const baselineTerminal = simulationResult?.medianTerminalWealth ?? 0;

  // Available sweep values (from analysis services)
  // SS: 62..70, Retirement: 55..65, Spending: 50k..100k step 5k
  const [retireAge, setRetireAge] = useState(clampInt(baselineRetireAge, 55, 65));
  const [spending, setSpending] = useState(snap(baselineSpending, 50000, 100000, 5000));
  const [ssAge, setSSAge] = useState(clampInt(baselineSSAge, 62, 70));

  // Look up results
  const ssResult = lookup(ssAnalysisResult, 'claimAge', ssAge)?.result;
  const spendingResult = lookup(spendingAnalysisResult, 'annualSpending', spending)?.result;
  const ageResult = lookup(retirementAgeAnalysisResult, 'retirementAge', retireAge)?.result;

  // Composite: average the deltas across the three independent analyses, applied to baseline.
  // (Each analysis varies one lever, holding the others at the user's plan, so we approximate
  // joint impact as additive deltas.)
  const deltas = [ageResult, spendingResult, ssResult].filter(Boolean) as SimulationResult[];
  const successDelta = deltas.length
    ? deltas.reduce((s, r) => s + (r.successProbability - baselineSuccess), 0)
    : 0;
  const terminalDelta = deltas.length
    ? deltas.reduce((s, r) => s + (r.medianTerminalWealth - baselineTerminal), 0)
    : 0;
  const liveSuccess = Math.max(0, Math.min(1, baselineSuccess + successDelta));
  const liveTerminal = Math.max(0, baselineTerminal + terminalDelta);

  const anyChange =
    retireAge !== baselineRetireAge || spending !== baselineSpending || ssAge !== baselineSSAge;

  // Per-lever deltas for the trade-off table
  const ageDelta = ageResult ? ageResult.successProbability - baselineSuccess : 0;
  const spendDelta = spendingResult ? spendingResult.successProbability - baselineSuccess : 0;
  const ssDelta = ssResult ? ssResult.successProbability - baselineSuccess : 0;

  const noAnalysis =
    !ssAnalysisResult?.length && !spendingAnalysisResult?.length && !retirementAgeAnalysisResult?.length;

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Decisions</h1>
          <div className="sub">The levers you control. Drag to see how each choice changes your plan.</div>
        </div>
      </div>

      {noAnalysis && (
        <div className="r-empty">Decision analyses are still running. They&rsquo;ll appear here as soon as the engine finishes.</div>
      )}

      <Card title="Your levers" sub={anyChange ? 'Comparing to your current plan' : 'Adjust to explore alternatives'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28 }}>
          <Lever
            label="Retire at"
            helper="When you stop working full-time"
            value={retireAge}
            baseline={baselineRetireAge}
            min={55} max={65}
            onChange={setRetireAge}
            format={v => `Age ${v}`}
          />
          <Lever
            label="Annual spending in retirement"
            helper="Today's dollars, before taxes"
            value={spending}
            baseline={baselineSpending}
            min={50000} max={100000} step={5000}
            onChange={setSpending}
            format={v => fmtCurrency(v)}
          />
          <Lever
            label="Claim Social Security at"
            helper="Earlier means smaller benefit, longer payout"
            value={ssAge}
            baseline={baselineSSAge}
            min={62} max={70}
            onChange={setSSAge}
            format={v => `Age ${v}`}
          />
        </div>

        <div className="r-divider" />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <DeltaCard
            label="Success probability"
            value={fmtPercent(liveSuccess, 0)}
            baseline={fmtPercent(baselineSuccess, 0)}
            deltaText={(successDelta >= 0 ? '+' : '') + (successDelta * 100).toFixed(1) + 'pp'}
            pos={successDelta >= 0}
            neutral={!anyChange}
          />
          <DeltaCard
            label="Median terminal wealth"
            value={fmtCurrency(liveTerminal, true)}
            baseline={fmtCurrency(baselineTerminal, true)}
            deltaText={(terminalDelta >= 0 ? '+' : '') + fmtCurrency(Math.abs(terminalDelta), true)}
            pos={terminalDelta >= 0}
            neutral={!anyChange}
          />
        </div>
      </Card>

      <div className="r-section-title"><h2>How each lever moves your plan</h2></div>
      <Card flush>
        <table className="r-tbl">
          <thead>
            <tr>
              <th>Lever</th>
              <th className="r">Current plan</th>
              <th className="r">Your choice</th>
              <th className="r">Δ Success</th>
              <th>Trade-off</th>
            </tr>
          </thead>
          <tbody>
            <LeverRow
              name="Retire at"
              cur={`Age ${baselineRetireAge}`}
              cho={`Age ${retireAge}`}
              delta={ageDelta}
              tradeoff="Working longer compounds savings and shortens the drawdown window."
            />
            <LeverRow
              name="Annual spending"
              cur={fmtCurrency(baselineSpending)}
              cho={fmtCurrency(spending)}
              delta={spendDelta}
              tradeoff="Higher spending burns through the portfolio faster — small changes compound across decades."
            />
            <LeverRow
              name="Claim Social Security"
              cur={`Age ${baselineSSAge}`}
              cho={`Age ${ssAge}`}
              delta={ssDelta}
              tradeoff="Delaying past full retirement age adds ~8% to your benefit per year delayed."
            />
          </tbody>
        </table>
      </Card>
    </>
  );
}

function clampInt(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, Math.round(v))); }
function snap(v: number, lo: number, hi: number, step: number) {
  const clamped = Math.max(lo, Math.min(hi, v));
  return Math.round(clamped / step) * step;
}
function lookup<T>(arr: T[] | null | undefined, key: keyof T, value: number): T | undefined {
  if (!arr) return undefined;
  let best: T | undefined; let bestDiff = Infinity;
  for (const item of arr) {
    const diff = Math.abs((item[key] as unknown as number) - value);
    if (diff < bestDiff) { best = item; bestDiff = diff; }
  }
  return best;
}

function Lever({
  label, helper, value, baseline, min, max, step, onChange, format,
}: {
  label: string; helper: string;
  value: number; baseline: number;
  min: number; max: number; step?: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const changed = value !== baseline;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--r-ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--r-ink-4)', marginTop: 2 }}>{helper}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{format(value)}</span>
        {changed && <span style={{ fontSize: 11, color: 'var(--r-ink-4)' }}>was {format(baseline)}</span>}
      </div>
      <SliderField hideLabel value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}

function DeltaCard({
  label, value, baseline, deltaText, pos, neutral,
}: {
  label: string; value: string; baseline: string;
  deltaText: string; pos: boolean; neutral?: boolean;
}) {
  return (
    <div style={{ background: 'var(--r-bg-sunk)', border: '1px solid var(--r-line)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10.5, color: 'var(--r-ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{value}</span>
        {!neutral && (
          <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: pos ? 'var(--r-pos)' : 'var(--r-neg)' }}>
            {deltaText}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--r-ink-4)' }}>current plan {baseline}</div>
    </div>
  );
}

function LeverRow({ name, cur, cho, delta, tradeoff }: { name: string; cur: string; cho: string; delta: number; tradeoff: string }) {
  const isPos = delta > 0;
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{name}</td>
      <td className="r mono" style={{ color: 'var(--r-ink-3)' }}>{cur}</td>
      <td className="r mono" style={{ fontWeight: 600 }}>{cho}</td>
      <td className="r mono" style={{ color: delta === 0 ? 'var(--r-ink-4)' : (isPos ? 'var(--r-pos)' : 'var(--r-neg)') }}>
        {delta === 0 ? '—' : (isPos ? '+' : '') + (delta * 100).toFixed(1) + 'pp'}
      </td>
      <td style={{ fontSize: 12, color: 'var(--r-ink-3)' }}>{tradeoff}</td>
    </tr>
  );
}
