import type { ReactNode } from 'react';

export function Card({
  title, sub, actions, children, flush, tight, className = '',
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  tight?: boolean;
  className?: string;
}) {
  return (
    <div className={`r-card ${className}`}>
      {(title || actions) && (
        <div className="r-card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`r-card-body ${flush ? 'flush' : ''} ${tight ? 'tight' : ''}`}>{children}</div>
    </div>
  );
}

export function KPI({
  label, value, unit, sub, hero, children,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`r-kpi ${hero ? 'hero' : ''}`}>
      <div className="r-kpi-label">{label}</div>
      <div className="r-kpi-value">{value}{unit && <span className="unit">{unit}</span>}</div>
      {sub && <div className="r-kpi-delta"><span>{sub}</span></div>}
      {children}
    </div>
  );
}

export function Toggle<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="r-toggle">
      {options.map(o => (
        <button key={o.value} data-active={value === o.value} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ tone = '', children, dot }: { tone?: '' | 'pos' | 'neg' | 'warn' | 'info'; children: ReactNode; dot?: string }) {
  return (
    <span className={`r-chip ${tone}`}>
      {dot && <span className="r-dot" style={{ background: dot }} />}
      {children}
    </span>
  );
}

export function SliderField({
  label, value, min, max, step = 1, onChange, format = (v) => String(v), hint, hideLabel,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
  hideLabel?: boolean;
}) {
  return (
    <div className="r-field">
      {!hideLabel && (
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span>{label}</span>
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--r-ink)', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{format(value)}</span>
        </label>
      )}
      <input
        className="r-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--r-ink-4)' }}>{hint}</div>}
    </div>
  );
}

export function Sparkline({
  data, color = 'var(--r-accent)', height = 28, fill = true,
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}) {
  if (!data || data.length === 0) return null;
  const w = 100, h = height;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
  const dFill = d + ` L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      {fill && <path d={dFill} fill={color} opacity="0.10" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
