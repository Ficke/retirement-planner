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
  niceLinearScale,
  ageTicks,
} from "@/components/ui/chart";
import { fmtAxisCurrency, fmtCurrency } from "@/components/retire/format";
import type { OutcomeCashFlowRow } from "@/domain/types";

const series = [
  { key: "earnedIncome", label: "Salary", color: "var(--color-account-salary)" },
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
  projections: OutcomeCashFlowRow[];
  height?: number;
}) {
  const data = useMemo(
    () => projections.map((row) => ({
      age: row.age,
      // In retirement `income` is the Social Security benefit, which the
      // benefit series already stacks.
      earnedIncome: row.isRetired ? 0 : row.income,
      socialSecurityBenefit: row.socialSecurityBenefit,
      withdrawalTraditional: row.withdrawalTraditional,
      withdrawalTaxable: row.withdrawalTaxable,
      withdrawalRoth: row.withdrawalRoth,
      withdrawalHSA: row.withdrawalHSA,
    })),
    [projections],
  );

  const activeSeries = useMemo(
    () => series.filter((s) => data.some((row) => row[s.key] > 0)),
    [data],
  );
  const yScale = useMemo(
    () => niceLinearScale(Math.max(0, ...data.map(
      (row) => series.reduce((total, s) => total + row[s.key], 0),
    ))),
    [data],
  );
  const xTicks = useMemo(
    () => ageTicks(data[0]?.age ?? 0, data[data.length - 1]?.age ?? 0),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center text-sm" style={{ height }}>
        No years in this filter
      </div>
    );
  }

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label="Average annual income by source for the selected outcome range"
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
          ticks={xTicks}
          interval={0}
        />
        <YAxis
          {...chartYAxisProps}
          domain={yScale.domain}
          ticks={yScale.ticks}
          tickFormatter={fmtAxisCurrency}
        />
        {activeSeries.map((s) => (
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
              hideZeroValues
              labelFormatter={(_label, payload) => {
                const age = payload?.[0]?.payload?.age;
                return age != null ? `Age ${age}` : "";
              }}
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">
                    {config[name as string]?.label ?? String(name)}
                  </span>
                  <span className="font-mono tabular-nums">
                    {fmtCurrency(Number(value), true)}
                  </span>
                </span>
              )}
              footer={(payload) => (
                <span className="flex w-full justify-between gap-4 font-medium">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">
                    {fmtCurrency(
                      payload.reduce((total, item) => total + Number(item.value ?? 0), 0),
                      true,
                    )}
                  </span>
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
