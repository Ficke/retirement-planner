"use client";

import type { ReactNode } from 'react';
import { usePlan } from '@/state/usePlan';
import { Card, Chip } from '../primitives';
import { Icon } from '../icons';

export function PageSettings() {
  const { plan, updatePlan, useServerSideCalculations, setUseServerSideCalculations } = usePlan();
  const updateAssumptions = (assumptions: Parameters<typeof updatePlan>[0]['assumptions']) => updatePlan({ assumptions });
  const a = plan.assumptions;

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">
            Runtime, randomness, and strategy options. The market model itself lives on Assumptions.
          </div>
        </div>
      </div>

      <div className="r-section-title"><h2>Compute</h2></div>
      <Card>
        <Setting label="Engine" helper="Where the simulation runs. Server is faster for large sweeps; local keeps your data on-device.">
          <select
            className="r-select"
            value={useServerSideCalculations ? 'server' : 'local'}
            onChange={e => setUseServerSideCalculations(e.target.value === 'server')}
            style={{ maxWidth: 320 }}
          >
            <option value="server">Server (Rust microservice)</option>
            <option value="local">Local (browser worker)</option>
          </select>
        </Setting>
      </Card>

      <div className="r-section-title"><h2>Randomness</h2></div>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <Setting label="Seed mode" helper="Fixed seed = identical results across runs (good for screenshots and regression tests). Random = fresh sample each run.">
            <div style={{ display: 'flex', gap: 8 }}>
              <RadioPill active={a.randomSeed != null} onClick={() => updateAssumptions({ randomSeed: a.randomSeed ?? 42 })}>Fixed</RadioPill>
              <RadioPill active={a.randomSeed == null} onClick={() => updateAssumptions({ randomSeed: undefined })}>Random</RadioPill>
            </div>
          </Setting>
          <Setting label="Seed value" helper="Used when seed mode is fixed.">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="r-input mono"
                type="number"
                value={a.randomSeed ?? ''}
                disabled={a.randomSeed == null}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '') updateAssumptions({ randomSeed: undefined });
                  else {
                    const n = parseInt(v, 10);
                    if (!isNaN(n) && n >= 0) updateAssumptions({ randomSeed: n });
                  }
                }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="r-btn"
                disabled={a.randomSeed == null}
                onClick={() => updateAssumptions({ randomSeed: Math.floor(Math.random() * 1e9) })}
              >
                <Icon name="refresh" /> New
              </button>
            </div>
          </Setting>
        </div>
      </Card>

      <div className="r-section-title"><h2>Strategy</h2></div>
      <Card>
        <Setting label="Backdoor Roth" helper="Convert post-tax dollars into Roth annually when income exceeds direct-Roth limits.">
          <div style={{ display: 'flex', gap: 8 }}>
            <RadioPill active={!!a.useBackdoorRoth} onClick={() => updateAssumptions({ useBackdoorRoth: true })}>On</RadioPill>
            <RadioPill active={!a.useBackdoorRoth} onClick={() => updateAssumptions({ useBackdoorRoth: false })}>Off</RadioPill>
          </div>
        </Setting>
      </Card>

      <div className="r-section-title"><h2>Developer</h2></div>
      <Card flush>
        <table className="r-tbl">
          <thead><tr><th>Item</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>Engine mode</td><td><Chip dot="var(--r-pos)">{useServerSideCalculations ? 'Server (Rust)' : 'Local (worker)'}</Chip></td><td style={{ color: 'var(--r-ink-3)' }}>Switch above under Compute</td></tr>
            <tr><td>Tax tables</td><td><Chip dot="var(--r-pos)">2025 loaded</Chip></td><td style={{ color: 'var(--r-ink-3)' }}>Federal{plan.profile.state === 'CA' ? ' + CA' : ''}</td></tr>
            <tr><td>RMD table</td><td><Chip dot="var(--r-pos)">SECURE 2.0</Chip></td><td style={{ color: 'var(--r-ink-3)' }}>2024+ uniform lifetime</td></tr>
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Setting({ label, helper, children }: { label: string; helper: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--r-ink)' }}>{label}</div>
      <div style={{ fontSize: 11.5, color: 'var(--r-ink-3)', lineHeight: 1.5 }}>{helper}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function RadioPill({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'var(--r-ink)' : 'var(--r-surface)',
        color: active ? 'var(--r-surface)' : 'var(--r-ink-2)',
        border: '1px solid ' + (active ? 'var(--r-ink)' : 'var(--r-line)'),
        borderRadius: 6,
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}
