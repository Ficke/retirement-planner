"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
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
  niceLinearScale,
  ageTicks,
} from "@/components/ui/chart";
import { fmtAxisCurrency, fmtCurrency } from "@/components/retire/format";
import type { YearlyProjection } from "@/domain/types";

type WealthProjection = Pick<
  YearlyProjection,
  "age" | "p25" | "p50" | "p75" | "isRetired"
>;

const config = {
  band75: { label: "25th–75th", color: "var(--color-success)" },
  p50: { label: "Median", color: "var(--color-success)" },
} as const;

export function WealthFanChart({
  projections,
  height = 280,
  retirementAge,
}: {
  projections: WealthProjection[];
  height?: number;
  retirementAge?: number;
}) {
  const data = useMemo(() => {
    return projections.map((p) => ({
      age: p.age,
      band75: [p.p25, p.p75] as [number, number],
      p50: p.p50,
      isRetired: p.isRetired,
    }));
  }, [projections]);

  const yScale = useMemo(
    () => niceLinearScale(Math.max(0, ...data.map((d) => d.band75[1]))),
    [data],
  );
  const xTicks = useMemo(
    () => ageTicks(data[0]?.age ?? 0, data[data.length - 1]?.age ?? 0),
    [data],
  );

  if (!projections || projections.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center text-sm"
        style={{ height }}
      >
        No projection data
      </div>
    );
  }

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label="Projected wealth by age, showing the median and 25th to 75th percentile range"
    >
      <ComposedChart accessibilityLayer data={data} margin={{ top: 24, right: 12, left: 8, bottom: 2 }}>
        <CartesianGrid {...chartGridProps} />
        <XAxis
          {...chartXAxisProps}
          dataKey="age"
          type="number"
          domain={["dataMin", "dataMax"]}
          ticks={xTicks}
        />
        <YAxis
          {...chartYAxisProps}
          domain={yScale.domain}
          ticks={yScale.ticks}
          tickFormatter={fmtAxisCurrency}
        />
        <Area
          type="monotone"
          dataKey="band75"
          stroke="none"
          fill="var(--color-band75)"
          fillOpacity={0.22}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="p50"
          stroke="var(--color-p50)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <ReferenceLine
          y={0}
          stroke="var(--color-foreground)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          zIndex={500}
        />
        {retirementAge != null && (
          <ReferenceLine
            x={retirementAge}
            stroke="var(--color-foreground)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{
              value: "RETIRE",
              position: "insideTopLeft",
              offset: 6,
              dy: -14,
              fill: "var(--color-muted-foreground)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--color-foreground)", strokeOpacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const age = payload?.[0]?.payload?.age;
                return age != null ? `Age ${age}` : "";
              }}
              formatter={(value, name) => {
                const v = Array.isArray(value) ? value : [value];
                const label = config[name as keyof typeof config]?.label ?? String(name);
                return (
                  <span className="flex w-full justify-between gap-3">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {v.map((n) => fmtCurrency(Number(n), true)).join(" – ")}
                    </span>
                  </span>
                );
              }}
            />
          }
        />
      </ComposedChart>
    </ChartContainer>
  );
}
