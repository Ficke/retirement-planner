"use client";

import { usePlan } from '@/state/usePlan';
import type { SimulationResult } from '@/domain/types';
import { Card, Chip } from '../primitives';
import { fmtCurrency, fmtPercent } from '../format';

type Point = { x: number; y: number };

export function PageSensitivity() {
  const { plan, ssAnalysisResult, spendingAnalysisResult, retirementAgeAnalysisResult } = usePlan();
  const isSimulating =
    usePlan(s => s.isSimulatingSS || s.isSimulatingSpending || s.isSimulatingRetirementAge);

  const agePts = toPoints(retirementAgeAnalysisResult, 'retirementAge');
  const spendPts = toPoints(spendingAnalysisResult, 'annualSpending');
  const ssPts = toPoints(ssAnalysisResult, 'claimAge');

  const empty =
    !retirementAgeAnalysisResult?.length &&
    !spendingAnalysisResult?.length &&
    !ssAnalysisResult?.length;

  return (
    <>
      <div className="r-page-head">
        <div>
          <h1>Sensitivity</h1>
          <div className="sub">
            How success probability moves as each lever sweeps across its range. Holds the other two at your current plan.
          </div>
        </div>
        <div className="right">
          <Chip dot={isSimulating ? 'var(--r-warn)' : 'var(--r-pos)'}>
            {isSimulating ? 'Recalculating' : 'Up to date'}
          </Chip>
        </div>
      </div>

      {empty && <div className="r-empty">Sweep analyses are still running.</div>}

      <div className="r-split-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <SensitivityCard
          title="Retirement age"
          xLabel="Age"
          xFormat={v => `Age ${v}`}
          points={agePts}
          marker={plan.profile.retirementAge}
        />
        <SensitivityCard
          title="Annual spending"
          xLabel="Spending"
          xFormat={v => fmtCurrency(v, true)}
          points={spendPts}
          marker={plan.profile.desiredSpending}
        />
        <SensitivityCard
          title="Social Security claim age"
          xLabel="Age"
          xFormat={v => `Age ${v}`}
          points={ssPts}
          marker={plan.socialSecurity.claimAge}
        />
      </div>
    </>
  );
}

function toPoints<T>(arr: T[] | null | undefined, xKey: keyof T): Point[] {
  if (!arr) return [];
  return arr
    .map(item => ({
      x: item[xKey] as unknown as number,
      y: (item as unknown as { result: SimulationResult }).result.successProbability,
    }))
    .sort((a, b) => a.x - b.x);
}

function SensitivityCard({
  title, xLabel, xFormat, points, marker,
}: {
  title: string;
  xLabel: string;
  xFormat: (v: number) => string;
  points: Point[];
  marker: number;
}) {
  return (
    <Card title={title} sub="Success probability across range">
      {points.length === 0 ? (
        <div className="r-empty" style={{ height: 200 }}>Loading…</div>
      ) : (
        <SensitivityChart points={points} marker={marker} xLabel={xLabel} xFormat={xFormat} />
      )}
    </Card>
  );
}

function SensitivityChart({
  points, marker, xLabel, xFormat,
}: {
  points: Point[];
  marker: number;
  xLabel: string;
  xFormat: (v: number) => string;
}) {
  const w = 300, h = 180;
  const padL = 36, padR = 10, padT = 14, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const xSpan = xMax - xMin || 1;

  // Y always 0..1 for success probability.
  const xPx = (x: number) => padL + ((x - xMin) / xSpan) * innerW;
  const yPx = (y: number) => padT + (1 - y) * innerH;

  const d = points
    .map((p, i) => (i === 0 ? 'M' : 'L') + xPx(p.x).toFixed(2) + ',' + yPx(p.y).toFixed(2))
    .join(' ');

  // Find marker y by linear interp into points.
  const inRange = marker >= xMin && marker <= xMax;
  let markerY: number | null = null;
  if (inRange) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (marker >= a.x && marker <= b.x) {
        const t = (marker - a.x) / (b.x - a.x || 1);
        markerY = a.y + t * (b.y - a.y);
        break;
      }
    }
    if (markerY == null) markerY = points[points.length - 1].y;
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
        {/* Y gridlines */}
        {yTicks.map(t => (
          <g key={t}>
            <line
              x1={padL} x2={w - padR}
              y1={yPx(t)} y2={yPx(t)}
              stroke="var(--r-line)" strokeWidth={t === 0 || t === 1 ? 1 : 0.5}
            />
            <text
              x={padL - 6} y={yPx(t) + 3}
              fontSize={9} fill="var(--r-ink-3)" textAnchor="end"
            >
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* X axis ticks: first, middle, last */}
        {[xMin, points[Math.floor(points.length / 2)].x, xMax].map((x, i) => (
          <text
            key={i}
            x={xPx(x)} y={h - padB + 14}
            fontSize={9} fill="var(--r-ink-3)" textAnchor="middle"
          >
            {xFormat(x)}
          </text>
        ))}

        {/* Marker line */}
        {inRange && markerY != null && (
          <>
            <line
              x1={xPx(marker)} x2={xPx(marker)}
              y1={padT} y2={padT + innerH}
              stroke="var(--r-accent)" strokeWidth={1} strokeDasharray="3 3"
              opacity={0.6}
            />
            <circle
              cx={xPx(marker)} cy={yPx(markerY)} r={3.5}
              fill="var(--r-accent)" stroke="var(--r-surface)" strokeWidth={1.5}
            />
          </>
        )}

        {/* Curve */}
        <path d={d} fill="none" stroke="var(--r-ink)" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--r-ink-3)' }}>
        <span>{xLabel}</span>
        <span className="mono">
          Current: {xFormat(marker)} · {inRange && markerY != null ? fmtPercent(markerY, 0) : 'outside swept range'}
        </span>
      </div>
    </div>
  );
}
