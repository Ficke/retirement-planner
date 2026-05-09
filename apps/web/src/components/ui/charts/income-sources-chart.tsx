"use client";

import { useMemo } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtCurrency } from "@/components/retire/format";
import type { YearlyProjection } from "@/domain/types";

type Pick6 = Pick<
  YearlyProjection,
  | "age"
  | "isRetired"
  | "socialSecurityBenefit"
  | "withdrawalTraditional"
  | "withdrawalTaxable"
  | "withdrawalRoth"
  | "withdrawalHSA"
>;

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
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="age"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickFormatter={(v) => fmtCurrency(v, true)}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={56}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stackId="1"
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.85}
            isAnimationActive={false}
          />
        ))}
        <ChartTooltip
          cursor={{ stroke: "var(--color-foreground)", strokeOpacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => `Age ${label}`}
              formatter={(value, name) => (
                <span className="font-mono">
                  {config[name as string]?.label ?? String(name)}: {fmtCurrency(Number(value), true)}
                </span>
              )}
            />
          }
        />
      </AreaChart>
    </ChartContainer>
  );
}

export const incomeSourcesLegend = series.map((s) => ({ label: s.label, color: s.color }));
