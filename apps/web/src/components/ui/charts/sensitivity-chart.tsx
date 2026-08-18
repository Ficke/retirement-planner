"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  chartGridProps,
  chartXAxisProps,
  chartYAxisProps,
} from "@/components/ui/chart";
import { fmtPercent } from "@/components/retire/format";

const config = {
  y: { label: "Success", color: "var(--color-success)" },
} as const;

export function SensitivityChart({
  points,
  marker,
  xLabel,
  xDomain,
  xTicks,
  xFormat = (v) => String(v),
  xTooltipFormat,
  height = 200,
}: {
  points: { x: number; y: number }[];
  marker?: { x: number; y: number };
  xLabel?: string;
  xDomain: [number, number];
  xTicks: number[];
  xFormat?: (v: number) => string;
  xTooltipFormat?: (v: number) => string;
  height?: number;
}) {
  const visiblePoints = useMemo(
    () => points
      .filter((point) => (
        Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && point.x >= xDomain[0]
        && point.x <= xDomain[1]
      ))
      .map((point) => ({ ...point, y: Math.max(0, Math.min(1, point.y)) })),
    [points, xDomain],
  );

  if (visiblePoints.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center text-sm" style={{ height }}>
        —
      </div>
    );
  }

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full overflow-hidden"
      style={{ height }}
      role="img"
      aria-label={`${xLabel ?? "Plan lever"} sensitivity: chance of success by ${xLabel?.toLowerCase() ?? "value"}`}
    >
      <LineChart
        accessibilityLayer
        data={visiblePoints}
        margin={{ top: 10, right: 20, left: 4, bottom: 24 }}
      >
        <CartesianGrid {...chartGridProps} />
        <XAxis
          {...chartXAxisProps}
          dataKey="x"
          type="number"
          domain={xDomain}
          ticks={xTicks}
          // allowDataOverflow would clip the plot rect, halving the dots and
          // the current-value marker at the domain edges.
          padding={{ left: 10, right: 10 }}
          tickFormatter={xFormat}
          height={44}
          label={{
            value: xLabel,
            position: "insideBottom",
            offset: -10,
            fill: "var(--color-muted-foreground)",
            fontSize: 11,
          }}
        />
        <YAxis
          {...chartYAxisProps}
          tickFormatter={(v) => fmtPercent(v)}
          domain={[0, 1.02]}
          ticks={[0, 0.5, 1]}
          width={44}
        />
        <Line
          type="linear"
          dataKey="y"
          stroke="var(--color-y)"
          strokeWidth={2}
          dot={{ r: 2.5, fill: "var(--color-y)", strokeWidth: 0 }}
          // Keep the hover marker hollow and small so it cannot be confused
          // with the solid marker for the plan's current value.
          activeDot={{
            r: 3,
            fill: "var(--color-background)",
            stroke: "var(--color-foreground)",
            strokeWidth: 1.5,
          }}
          isAnimationActive={false}
        />
        {marker && (
          <ReferenceDot
            x={marker.x}
            y={marker.y}
            r={5}
            fill="var(--color-success)"
            stroke="var(--color-card)"
            strokeWidth={2}
          />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--color-foreground)", strokeOpacity: 0.4 }}
          content={
            <ChartTooltipContent
              // The tooltip label arrives as the series config label ("Success"),
              // not the x value, because a numeric XAxis skips ChartTooltipContent's
              // string branch. Read x off the datum instead.
              labelFormatter={(_, payload) => {
                const x = Number(payload?.[0]?.payload?.x);
                return xTooltipFormat?.(x) ?? xFormat(x);
              }}
              formatter={(value) => (
                <span className="font-mono">Success: {fmtPercent(Number(value))}</span>
              )}
            />
          }
        />
      </LineChart>
    </ChartContainer>
  );
}
