"use client";

export function ProbabilityRing({
  value,
  size = 132,
  thickness = 10,
}: {
  value: number;
  size?: number;
  thickness?: number;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, value)));
  const tone =
    value >= 0.85
      ? "var(--color-success)"
      : value >= 0.7
      ? "var(--color-warn)"
      : "var(--color-danger)";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ overflow: "visible" }}
      role="img"
      aria-label={`Success probability ${Math.round(value * 100)} percent`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="stroke-muted"
        strokeWidth={thickness}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={tone}
        strokeWidth={thickness}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x={size / 2}
        y={size / 2 - 2}
        textAnchor="middle"
        className="fill-foreground"
        fontSize="28"
        fontWeight="500"
      >
        {Math.round(value * 100)}
        <tspan className="fill-muted-foreground" fontSize="14">
          %
        </tspan>
      </text>
      <text
        x={size / 2}
        y={size / 2 + 16}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize="9.5"
        letterSpacing="0.06em"
      >
        SUCCESS
      </text>
    </svg>
  );
}
