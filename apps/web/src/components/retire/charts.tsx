"use client";

import { useMemo, useRef, useState } from 'react';
import type { YearlyProjection } from '@/domain/types';
import { fmtCurrency } from './format';

type Projection = Pick<
  YearlyProjection,
  'age' | 'p5' | 'p10' | 'p15' | 'p25' | 'p50' | 'p75' | 'p90' | 'isRetired' | 'portfolioValue' |
  'socialSecurityBenefit' | 'withdrawalTraditional' | 'withdrawalTaxable' | 'withdrawalRoth' | 'withdrawalHSA'
>;

export function WealthFanChart({
  projections, height = 280, retirementAge, showAxes = true,
}: {
  projections: Projection[];
  height?: number;
  retirementAge?: number;
  showAxes?: boolean;
}) {
  const [hover, setHover] = useState<{ p: Projection; px: number; py: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  if (!projections || projections.length === 0) {
    return <div className="r-empty" style={{ height }}>No projection data</div>;
  }

  const w = 1000, h = height;
  const padL = showAxes ? 56 : 8, padR = 12, padT = 12, padB = showAxes ? 28 : 12;
  const innerW = w - padL - padR, innerH = h - padT - padB;

  const minAge = projections[0].age;
  const maxAge = projections[projections.length - 1].age;
  const maxVal = Math.max(1, ...projections.map(p => p.p90 || 0)) * 1.05;

  const x = (age: number) => padL + ((age - minAge) / (maxAge - minAge)) * innerW;
  const y = (v: number) => padT + innerH - (v / maxVal) * innerH;

  const buildBand = (top: keyof Projection, bot: keyof Projection) => {
    const topPath = projections.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.age)},${y(p[top] as number)}`).join(' ');
    const botPath = projections.slice().reverse().map(p => `L${x(p.age)},${y(p[bot] as number)}`).join(' ');
    return topPath + ' ' + botPath + ' Z';
  };

  const medianPath = projections.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.age)},${y(p.p50)}`).join(' ');

  const yTicks: number[] = [];
  const tickStep = maxVal > 5_000_000 ? 2_000_000 : maxVal > 2_000_000 ? 1_000_000 : 500_000;
  for (let v = 0; v <= maxVal; v += tickStep) yTicks.push(v);
  const xTicks: number[] = [];
  for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) xTicks.push(a);

  const onMove = (e: React.MouseEvent) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const age = Math.round(minAge + ((px - padL) / innerW) * (maxAge - minAge));
    const p = projections.find(p => p.age === age);
    if (p) setHover({ p, px: (x(p.age) / w) * rect.width, py: (y(p.p50) / h) * rect.height });
  };

  const retX = retirementAge ? x(retirementAge) : null;

  return (
    <div className="r-chart-wrap" ref={wrapRef} style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="medianGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--r-accent)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--r-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {showAxes && yTicks.map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--r-line)" strokeDasharray="2 3" />
            <text x={padL - 8} y={y(v) + 3} fontSize="9.5" fill="var(--r-ink-3)" textAnchor="end" fontFamily="var(--font-jetbrains-mono)">{fmtCurrency(v, true)}</text>
          </g>
        ))}
        <path d={buildBand('p90', 'p10')} fill="var(--r-accent)" opacity="0.08" />
        <path d={buildBand('p75', 'p25')} fill="var(--r-accent)" opacity="0.16" />
        {retX != null && (
          <g>
            <line x1={retX} x2={retX} y1={padT} y2={h - padB} stroke="var(--r-ink-3)" strokeDasharray="3 3" strokeWidth="1" />
            <rect x={retX - 26} y={padT + 2} width="52" height="14" rx="3" fill="var(--r-ink)" />
            <text x={retX} y={padT + 12} fontSize="9" fill="var(--r-bg-elev)" textAnchor="middle" fontWeight="600" letterSpacing="0.04em">RETIRE</text>
          </g>
        )}
        <path d={`${medianPath} L${x(maxAge)},${h - padB} L${x(minAge)},${h - padB} Z`} fill="url(#medianGrad)" />
        <path d={medianPath} fill="none" stroke="var(--r-accent)" strokeWidth="2" />
        {showAxes && xTicks.map(a => (
          <text key={a} x={x(a)} y={h - padB + 14} fontSize="10" fill="var(--r-ink-3)" textAnchor="middle" fontFamily="var(--font-jetbrains-mono)">{a}</text>
        ))}
        {showAxes && <text x={w - padR} y={h - 4} fontSize="9" fill="var(--r-ink-4)" textAnchor="end">AGE</text>}
        {hover && (
          <g>
            <line x1={x(hover.p.age)} x2={x(hover.p.age)} y1={padT} y2={h - padB} stroke="var(--r-ink)" strokeWidth="0.75" />
            <circle cx={x(hover.p.age)} cy={y(hover.p.p50)} r="4" fill="var(--r-accent)" stroke="var(--r-bg-elev)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="r-tt" style={{ left: hover.px, top: hover.py }}>
          <div className="r-tt-row"><span className="r-tt-label">Age {hover.p.age}</span><span className="r-tt-val">{hover.p.isRetired ? 'Retired' : 'Working'}</span></div>
          <div className="r-tt-row"><span className="r-tt-label">Median</span><span className="r-tt-val">{fmtCurrency(hover.p.p50, true)}</span></div>
          <div className="r-tt-row"><span className="r-tt-label">P90 / P10</span><span className="r-tt-val">{fmtCurrency(hover.p.p90, true)} / {fmtCurrency(hover.p.p10, true)}</span></div>
        </div>
      )}
    </div>
  );
}

export function IncomeSourcesChart({ projections, height = 240 }: { projections: Projection[]; height?: number }) {
  const w = 1000, h = height, padL = 56, padR = 12, padT = 12, padB = 28;
  const innerW = w - padL - padR, innerH = h - padT - padB;

  const retiredOnly = useMemo(() => projections.filter(p => p.isRetired), [projections]);
  if (retiredOnly.length === 0) return <div className="r-empty">No retirement years</div>;

  const minAge = retiredOnly[0].age, maxAge = retiredOnly[retiredOnly.length - 1].age;

  const series: { key: keyof Projection; label: string; color: string }[] = [
    { key: 'socialSecurityBenefit', label: 'Social Security', color: 'var(--r-c-ss)' },
    { key: 'withdrawalTraditional', label: 'Traditional', color: 'var(--r-c-traditional)' },
    { key: 'withdrawalTaxable', label: 'Taxable', color: 'var(--r-c-taxable)' },
    { key: 'withdrawalRoth', label: 'Roth', color: 'var(--r-c-roth)' },
    { key: 'withdrawalHSA', label: 'HSA', color: 'var(--r-c-hsa)' },
  ];

  const stacks = retiredOnly.map(p => {
    let acc = 0;
    return series.map(s => {
      const v = (p[s.key] as number) || 0;
      const o = { y0: acc, y1: acc + v };
      acc += v;
      return o;
    });
  });
  const maxTotal = Math.max(1, ...stacks.map(s => s[s.length - 1].y1));

  const x = (age: number) => padL + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
  const y = (v: number) => padT + innerH - (v / maxTotal) * innerH;

  const yTicks: number[] = [];
  const step = maxTotal > 200000 ? 50000 : 25000;
  for (let v = 0; v <= maxTotal; v += step) yTicks.push(v);

  const xTickAges = [minAge];
  for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) if (a > minAge) xTickAges.push(a);

  return (
    <div className="r-chart-wrap" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {yTicks.map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--r-line)" strokeDasharray="2 3" />
            <text x={padL - 8} y={y(v) + 3} fontSize="9.5" fill="var(--r-ink-3)" textAnchor="end" fontFamily="var(--font-jetbrains-mono)">{fmtCurrency(v, true)}</text>
          </g>
        ))}
        {series.map((s, sIdx) => {
          const top = retiredOnly.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.age)},${y(stacks[i][sIdx].y1)}`).join(' ');
          const bot = retiredOnly.slice().reverse().map((p, i) => {
            const idx = retiredOnly.length - 1 - i;
            return `L${x(p.age)},${y(stacks[idx][sIdx].y0)}`;
          }).join(' ');
          return <path key={s.key as string} d={top + ' ' + bot + ' Z'} fill={s.color} opacity="0.85" />;
        })}
        {xTickAges.map(a => (
          <text key={a} x={x(a)} y={h - padB + 14} fontSize="10" fill="var(--r-ink-3)" textAnchor="middle" fontFamily="var(--font-jetbrains-mono)">{a}</text>
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, paddingLeft: 6 }}>
        {series.map(s => (
          <div key={s.key as string} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--r-ink-2)' }}>
            <span className="r-dot" style={{ background: s.color }} />{s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({
  data, size = 120, thickness = 14, centerLabel, centerValue,
}: {
  data: { value: number; color: string; label?: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const r = size / 2;
  const innerR = r - thickness;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let angle = -Math.PI / 2;

  const arcs = data.map(d => {
    const a0 = angle;
    const a1 = angle + (d.value / total) * Math.PI * 2;
    angle = a1;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = r + r * Math.cos(a0), y0 = r + r * Math.sin(a0);
    const x1 = r + r * Math.cos(a1), y1 = r + r * Math.sin(a1);
    const ix0 = r + innerR * Math.cos(a1), iy0 = r + innerR * Math.sin(a1);
    const ix1 = r + innerR * Math.cos(a0), iy1 = r + innerR * Math.sin(a0);
    return {
      d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${ix0},${iy0} A${innerR},${innerR} 0 ${large} 0 ${ix1},${iy1} Z`,
      color: d.color,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} stroke="var(--r-surface)" strokeWidth="1.5" />)}
      {centerLabel && (
        <>
          <text x={r} y={r - 6} textAnchor="middle" fontSize="9.5" fill="var(--r-ink-3)" letterSpacing="0.04em">{centerLabel}</text>
          <text x={r} y={r + 10} textAnchor="middle" fontSize="14" fill="var(--r-ink)" fontWeight="600" fontFamily="var(--font-jetbrains-mono)">{centerValue}</text>
        </>
      )}
    </svg>
  );
}

export function ProbabilityRing({ value, size = 132, thickness = 10 }: { value: number; size?: number; thickness?: number }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, value)));
  const tone = value >= 0.85 ? 'var(--r-pos)' : value >= 0.7 ? 'var(--r-warn)' : 'var(--r-neg)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--r-bg-sunk)" strokeWidth={thickness} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={tone} strokeWidth={thickness} fill="none"
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="28" fontFamily="var(--font-newsreader)" fill="var(--r-ink)" fontWeight="500">
        {Math.round(value * 100)}<tspan fontSize="14" fill="var(--r-ink-3)">%</tspan>
      </text>
      <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize="9.5" fill="var(--r-ink-3)" letterSpacing="0.06em">SUCCESS</text>
    </svg>
  );
}

export function PercentileBars({ projections }: { projections: Projection[] }) {
  if (!projections || projections.length === 0) return null;
  const last = projections[projections.length - 1];
  const buckets = [
    { label: '5th', value: last.p5, color: 'oklch(60% 0.18 25)' },
    { label: '10th', value: last.p10, color: 'oklch(65% 0.16 40)' },
    { label: '25th', value: last.p25, color: 'oklch(72% 0.14 70)' },
    { label: '50th', value: last.p50, color: 'var(--r-accent)' },
    { label: '75th', value: last.p75, color: 'oklch(60% 0.12 200)' },
    { label: '90th', value: last.p90, color: 'oklch(55% 0.13 230)' },
  ];
  const max = Math.max(...buckets.map(b => b.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
      {buckets.map(b => (
        <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${(b.value / max) * 100}%`, background: b.color, borderRadius: '3px 3px 0 0', position: 'relative', transition: 'height .3s' }}>
              <div style={{ position: 'absolute', top: -16, left: 0, right: 0, textAlign: 'center', fontSize: 10.5, color: 'var(--r-ink-2)', fontFamily: 'var(--font-jetbrains-mono)', fontWeight: 600 }}>
                {fmtCurrency(b.value, true)}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--r-ink-3)', fontFamily: 'var(--font-jetbrains-mono)' }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}
