"use client";

export function Donut({
  data,
  size = 120,
  thickness = 14,
  centerLabel,
  centerValue,
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

  const arcs = data.map((d) => {
    const a0 = angle;
    const a1 = angle + (d.value / total) * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = r + r * Math.cos(a0);
    const y0 = r + r * Math.sin(a0);
    const x1 = r + r * Math.cos(a1);
    const y1 = r + r * Math.sin(a1);
    const ix0 = r + innerR * Math.cos(a1);
    const iy0 = r + innerR * Math.sin(a1);
    const ix1 = r + innerR * Math.cos(a0);
    const iy1 = r + innerR * Math.sin(a0);
    return {
      d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${ix0},${iy0} A${innerR},${innerR} 0 ${large} 0 ${ix1},${iy1} Z`,
      color: d.color,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill={a.color} stroke="var(--color-card)" strokeWidth="1.5" />
      ))}
      {centerLabel && (
        <>
          <text
            x={r}
            y={r - 6}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize="9.5"
            letterSpacing="0.04em"
          >
            {centerLabel}
          </text>
          <text
            x={r}
            y={r + 10}
            textAnchor="middle"
            className="fill-foreground font-mono"
            fontSize="14"
            fontWeight="600"
          >
            {centerValue}
          </text>
        </>
      )}
    </svg>
  );
}
