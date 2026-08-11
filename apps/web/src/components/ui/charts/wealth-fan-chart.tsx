"use client";

import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtCurrency } from "@/components/retire/format";
import type { YearlyProjection } from "@/domain/types";

type Pick4 = Pick<
  YearlyProjection,
  "age" | "p10" | "p25" | "p50" | "p75" | "p90" | "isRetired"
>;

const config = {
  band90: { label: "10th–90th", color: "var(--color-success)" },
  band75: { label: "25th–75th", color: "var(--color-success)" },
  p50: { label: "Median", color: "var(--color-success)" },
} as const;

export function WealthFanChart({
  projections,
  height = 280,
  retirementAge,
}: {
  projections: Pick4[];
  height?: number;
  retirementAge?: number;
}) {
  const { data, yMax } = useMemo(() => {
    const p90Max = Math.max(1, ...projections.map((p) => p.p90 || 0));
    const cap = p90Max * 1.05;
    const rows = projections.map((p) => ({
      age: p.age,
      band90: [p.p10, p.p90] as [number, number],
      band75: [p.p25, p.p75] as [number, number],
      p50: p.p50,
      isRetired: p.isRetired,
    }));
    return { data: rows, yMax: cap };
  }, [projections]);

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
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <ComposedChart data={data} margin={{ top: 24, right: 12, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="age"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          domain={[0, yMax]}
          tickFormatter={(v) => fmtCurrency(v, true)}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={56}
        />
        <Area
          type="monotone"
          dataKey="band90"
          stroke="none"
          fill="var(--color-band90)"
          fillOpacity={0.12}
          isAnimationActive={false}
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
