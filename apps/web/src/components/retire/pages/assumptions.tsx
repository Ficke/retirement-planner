"use client";

import { usePlan } from '@/state/usePlan';
import {
  US_STOCK_REAL_RETURNS_1926_2024,
  US_BOND_REAL_RETURNS_1926_2024,
  US_INFLATION_1926_2024,
  ASSET_CORRELATION_MATRIX_1926_2024,
} from '@/data/market-history';
import { Card } from '../primitives';
import { Donut } from '../charts';

// What the simulation actually uses — hardcoded in market-history.ts
// (TS engine) and mirrored in rust-simulation-service/.../parametric_returns.rs.
const ENGINE = {
  stocks: { mean: US_STOCK_REAL_RETURNS_1926_2024.mean, vol: US_STOCK_REAL_RETURNS_1926_2024.volatility },
  bonds: { mean: US_BOND_REAL_RETURNS_1926_2024.mean, vol: US_BOND_REAL_RETURNS_1926_2024.volatility },
  inflation: { mean: US_INFLATION_1926_2024.mean, vol: US_INFLATION_1926_2024.volatility },
  correlation: ASSET_CORRELATION_MATRIX_1926_2024.stocks_bonds,
} as const;

export function PageAssumptions() {
  const { plan } = usePlan();

  // Portfolio-weighted stocks/bonds from current accounts
  const totalBal = plan.accounts.reduce((s, a) => s + a.balance, 0);
  const stockWeight = totalBal > 0
    ? plan.accounts.reduce((s, a) => s + a.balance * a.assetWeights.stocks, 0) / totalBal
    : 0.6;
  const bondWeight = 1 - stockWeight;

  const expectedReturn = (ENGINE.stocks.mean * stockWeight + ENGINE.bonds.mean * bondWeight) * 100;
  const expectedVol = Math.sqrt(
    Math.pow(ENGINE.stocks.vol * stockWeight, 2) +
    Math.pow(ENGINE.bonds.vol * bondWeight, 2) +
    2 * stockWeight * bondWeight * ENGINE.stocks.vol * ENGINE.bonds.vol * ENGINE.correlation
  ) * 100;

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Assumptions</h1>
          <div className="sub">
            What the Monte Carlo simulation assumes about the world. Engine constants from US 1926–2024 history, shown for transparency.
          </div>
        </div>
      </div>

      <div className="r-section-title"><h2>Market model</h2></div>
      <div className="r-split-2">
        <Card title="Asset class assumptions" sub="Real (after-inflation) returns. Hardcoded from US 1926–2024 history." flush>
          <table className="r-tbl">
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
                <td className="r mono">{(ENGINE.stocks.mean * 100).toFixed(1)}%</td>
                <td className="r mono">{(ENGINE.stocks.vol * 100).toFixed(1)}%</td>
              </tr>
              <tr>
                <td>
                  <span className="r-dot" style={{ background: 'var(--r-c-hsa)', marginRight: 8, width: 9, height: 9 }} />
                  Bonds
                </td>
                <td className="r mono">{(bondWeight * 100).toFixed(0)}%</td>
                <td className="r mono">{(ENGINE.bonds.mean * 100).toFixed(1)}%</td>
                <td className="r mono">{(ENGINE.bonds.vol * 100).toFixed(1)}%</td>
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
          <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--r-ink-3)', borderTop: '1px solid var(--r-line)', background: 'var(--r-bg-sunk)' }}>
            Asset-class returns and vol are baked into the engine. The parametric mode samples from these directly; the bootstrap mode resamples the historical sequences they were derived from.
          </div>
        </Card>
        <Card title="Allocation" sub="Stock/bond split across all your accounts">
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
              Allocation is portfolio-weighted from each account&rsquo;s stock/bond split. Edit individual account allocations on the Accounts page.
            </div>
          </div>
        </Card>
      </div>

      <div className="r-section-title"><h2>Economic &amp; rule assumptions</h2></div>
      <Card flush>
        <table className="r-tbl">
          <thead><tr><th>Assumption</th><th className="r">Value</th><th>Source</th></tr></thead>
          <tbody>
            <tr><td>Long-run inflation (CPI)</td><td className="r mono">{(ENGINE.inflation.mean * 100).toFixed(1)}%</td><td style={{ color: 'var(--r-ink-3)' }}>US 1926–2024, real returns net of inflation</td></tr>
            <tr><td>Stock/bond correlation</td><td className="r mono">{ENGINE.correlation.toFixed(2)}</td><td style={{ color: 'var(--r-ink-3)' }}>US 1926–2024 historical</td></tr>
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
            <tr><td>Method</td><td className="r mono">Historical bootstrap</td><td style={{ color: 'var(--r-ink-3)' }}>Resamples real US 1926–2024 years in 3-year blocks</td></tr>
            <tr><td>Paths per simulation</td><td className="r mono">5,000</td><td style={{ color: 'var(--r-ink-3)' }}>Independent Monte Carlo trajectories</td></tr>
            <tr><td>Time horizon</td><td className="r mono">Age {plan.profile.age} → {plan.profile.lifeExpectancy}</td><td style={{ color: 'var(--r-ink-3)' }}>Set on Profile</td></tr>
            <tr><td>Step size</td><td className="r mono">Annual</td><td style={{ color: 'var(--r-ink-3)' }}>End-of-year valuation</td></tr>
            <tr><td>Bootstrap block size</td><td className="r mono">3 years</td><td style={{ color: 'var(--r-ink-3)' }}>Preserves multi-year sequences (e.g. 2008 → 2009)</td></tr>
          </tbody>
        </table>
      </Card>
    </>
  );
}
