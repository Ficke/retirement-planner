"use client";

import { usePlan } from '@/state/usePlan';
import presets from '@/data/cma/presets.json';
import { Card } from '../primitives';
import { Donut } from '../charts';

type PresetKey = 'Conservative' | 'Moderate' | 'Aggressive';
type PresetEntry = { name: string; description: string; stocks: { mean: number; vol: number }; bonds: { mean: number; vol: number }; inflation: { mean: number; vol: number } };
const PRESETS = presets as unknown as Record<PresetKey, PresetEntry>;

export function PageAssumptions() {
  const { plan, updateAssumptions } = usePlan();
  const presetKey = (plan.assumptions.preset ?? 'Moderate') as PresetKey;
  const cma = PRESETS[presetKey] ?? PRESETS.Moderate;

  // Portfolio-weighted stocks/bonds from current accounts
  const totalBal = plan.accounts.reduce((s, a) => s + a.balance, 0);
  const stockWeight = totalBal > 0
    ? plan.accounts.reduce((s, a) => s + a.balance * a.assetWeights.stocks, 0) / totalBal
    : 0.6;
  const bondWeight = 1 - stockWeight;

  const expectedReturn = (cma.stocks.mean * stockWeight + cma.bonds.mean * bondWeight) * 100;
  const expectedVol = Math.sqrt(
    Math.pow(cma.stocks.vol * stockWeight, 2) + Math.pow(cma.bonds.vol * bondWeight, 2)
  ) * 100;

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Assumptions</h1>
          <div className="sub">
            The inputs your Monte Carlo simulation runs against. Change these to test how sensitive your plan is.
          </div>
        </div>
      </div>

      <div className="r-section-title"><h2>Market model</h2></div>
      <div className="r-split-2">
        <Card title="Capital market expectations" sub="Per asset class, real (after-inflation)" flush>
          <div style={{ padding: '10px 18px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--r-ink-3)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Preset</label>
            <select
              className="r-select"
              value={presetKey}
              onChange={e => updateAssumptions({ preset: e.target.value as PresetKey })}
              style={{ width: 'auto' }}
            >
              {(Object.keys(PRESETS) as PresetKey[]).map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <span style={{ fontSize: 11.5, color: 'var(--r-ink-3)' }}>{cma.description}</span>
          </div>
          <table className="r-tbl" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Asset class</th>
                <th className="r">Weight</th>
                <th className="r">Expected return</th>
                <th className="r">Volatility</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="r-dot" style={{ background: 'var(--r-c-traditional)', marginRight: 8, width: 9, height: 9 }} />
                  Stocks
                </td>
                <td className="r mono">{(stockWeight * 100).toFixed(0)}%</td>
                <td className="r mono">{(cma.stocks.mean * 100).toFixed(1)}%</td>
                <td className="r mono">{(cma.stocks.vol * 100).toFixed(1)}%</td>
              </tr>
              <tr>
                <td>
                  <span className="r-dot" style={{ background: 'var(--r-c-hsa)', marginRight: 8, width: 9, height: 9 }} />
                  Bonds
                </td>
                <td className="r mono">{(bondWeight * 100).toFixed(0)}%</td>
                <td className="r mono">{(cma.bonds.mean * 100).toFixed(1)}%</td>
                <td className="r mono">{(cma.bonds.vol * 100).toFixed(1)}%</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--r-bg-sunk)' }}>
                <td style={{ fontWeight: 600, color: 'var(--r-ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Portfolio (derived)</td>
                <td className="r mono" style={{ fontWeight: 600 }}>100%</td>
                <td className="r mono" style={{ fontWeight: 600 }}>{expectedReturn.toFixed(1)}%</td>
                <td className="r mono" style={{ fontWeight: 600 }}>{expectedVol.toFixed(1)}%</td>
              </tr>
            </tfoot>
          </table>
        </Card>
        <Card title="Allocation" sub="Stacks across all your accounts">
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Donut
              data={[
                { value: stockWeight, color: 'var(--r-c-traditional)' },
                { value: bondWeight, color: 'var(--r-c-hsa)' },
              ]}
              size={140}
              thickness={20}
              centerLabel="Stocks"
              centerValue={(stockWeight * 100).toFixed(0) + '%'}
            />
            <div style={{ flex: 1, fontSize: 12.5, color: 'var(--r-ink-2)', lineHeight: 1.6 }}>
              The simulation samples annual stock and bond returns from each preset using a joint distribution, with a fixed correlation calibrated to long-run history. Allocation comes from your accounts&rsquo; current asset weights.
            </div>
          </div>
        </Card>
      </div>

      <div className="r-section-title"><h2>Economic &amp; rule assumptions</h2></div>
      <Card flush>
        <table className="r-tbl">
          <thead><tr><th>Assumption</th><th className="r">Value</th><th>Source</th></tr></thead>
          <tbody>
            <tr><td>Long-run inflation (CPI)</td><td className="r mono">{(cma.inflation.mean * 100).toFixed(1)}%</td><td style={{ color: 'var(--r-ink-3)' }}>Active CMA preset</td></tr>
            <tr><td>Stock/bond correlation</td><td className="r mono">0.15</td><td style={{ color: 'var(--r-ink-3)' }}>Long-run historical, 30y</td></tr>
            <tr><td>Tax brackets</td><td className="r mono">{plan.profile.state === 'CA' ? 'Federal 2025 + CA 2025' : 'Federal 2025'}</td><td style={{ color: 'var(--r-ink-3)' }}>IRS{plan.profile.state === 'CA' ? ' / FTB' : ''}</td></tr>
            <tr><td>RMD table</td><td className="r mono">SECURE 2.0 (2024+)</td><td style={{ color: 'var(--r-ink-3)' }}>IRS Pub. 590-B</td></tr>
            <tr><td>Contribution limits</td><td className="r mono">2025</td><td style={{ color: 'var(--r-ink-3)' }}>IRS</td></tr>
          </tbody>
        </table>
      </Card>

      <div className="r-section-title"><h2>Simulation parameters</h2></div>
      <Card flush>
        <table className="r-tbl">
          <thead><tr><th>Parameter</th><th className="r">Value</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>Time horizon</td><td className="r mono">Age → life expectancy</td><td style={{ color: 'var(--r-ink-3)' }}>Set on Plan</td></tr>
            <tr><td>Step size</td><td className="r mono">Annual</td><td style={{ color: 'var(--r-ink-3)' }}>End-of-year valuation</td></tr>
            <tr><td>Rebalancing</td><td className="r mono">{plan.assumptions.rebalanceAnnually ? 'Annual to target' : 'Off'}</td><td style={{ color: 'var(--r-ink-3)' }}>Toggleable in Settings</td></tr>
            <tr><td>Simulation model</td><td className="r mono">{plan.assumptions.simulationModel === 'parametric' ? 'Parametric' : 'Historical bootstrap'}</td><td style={{ color: 'var(--r-ink-3)' }}>Toggleable in Settings</td></tr>
          </tbody>
        </table>
      </Card>
    </>
  );
}
