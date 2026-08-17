"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  chartGridProps,
  chartXAxisProps,
  chartYAxisProps,
} from "@/components/ui/chart";
import { fmtCurrency } from "@/components/retire/format";
import type { IncomeSourcesRow } from "@/domain/types";

type Pick6 = IncomeSourcesRow;

const series = [
  { key: "socialSecurityBenefit", label: "Social Security", color: "var(--color-account-ss)" },
  { key: "withdrawalTraditional", label: "Traditional", color: "var(--color-account-traditional)" },
  { key: "withdrawalTaxable", label: "Taxable", color: "var(--color-account-taxable)" },
  { key: "withdrawalRoth", label: "Roth", color: "var(--color-account-roth)" },
  { key: "withdrawalHSA", label: "HSA", color: "var(--color-account-hsa)" },
] as const;

const config = Object.fromEntries(
  series.map((s) => [s.key, { label: s.label, color: s.color }]),
);

export function IncomeSourcesChart({
  projections,
  height = 240,
}: {
  projections: Pick6[];
  height?: number;
}) {
  const data = useMemo(() => projections.filter((p) => p.isRetired), [projections]);
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center text-sm" style={{ height }}>
        No retirement years
      </div>
    );
  }

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label="Average annual retirement income by source for the selected outcome range"
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 12, left: 8, bottom: 0 }}
        barCategoryGap="18%"
      >
        <CartesianGrid {...chartGridProps} />
        <XAxis
          {...chartXAxisProps}
          dataKey="age"
          type="category"
          interval="preserveStartEnd"
          minTickGap={48}
        />
        <YAxis
          {...chartYAxisProps}
          domain={[0, "auto"]}
          tickCount={5}
          tickFormatter={(v) => fmtCurrency(v, true)}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="1"
            fill={s.color}
            isAnimationActive={false}
          />
        ))}
        <ChartTooltip
          cursor={{ stroke: "var(--color-foreground)", strokeOpacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => {
                const age = payload?.[0]?.payload?.age;
                return age != null ? `Age ${age}` : "";
              }}
              formatter={(value, name) => (
                <span className="font-mono">
                  {config[name as string]?.label ?? String(name)}: {fmtCurrency(Number(value), true)}
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  );
}
