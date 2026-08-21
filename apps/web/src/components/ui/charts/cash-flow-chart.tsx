"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

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
import type { OutcomeCashFlowRow } from "@/domain/types";

type Series = { key: string; label: string; color: string };

// Stacked from the zero line outward. The four account types run in the order
// the engine draws them down, so the ramp lightens toward what is spent first.
const inflow: Series[] = [
  { key: "earnedIncome", label: "Salary", color: "var(--color-account-salary)" },
  { key: "socialSecurityBenefit", label: "Social Security", color: "var(--color-account-ss)" },
  { key: "withdrawalTaxable", label: "Taxable", color: "var(--color-account-taxable)" },
  { key: "withdrawalTraditional", label: "Traditional", color: "var(--color-account-traditional)" },
  { key: "withdrawalRoth", label: "Roth", color: "var(--color-account-roth)" },
  { key: "withdrawalHSA", label: "HSA", color: "var(--color-account-hsa)" },
];

const outflow: Series[] = [
  { key: "living", label: "Living", color: "var(--color-spend-living)" },
  { key: "healthcareCost", label: "Healthcare", color: "var(--color-spend-healthcare)" },
  { key: "taxes", label: "Tax", color: "var(--color-spend-tax)" },
  { key: "saved", label: "Saved", color: "var(--color-spend-saved)" },
];

const config = Object.fromEntries(
  [...inflow, ...outflow].map((s) => [s.key, { label: s.label, color: s.color }]),
);

type Row = Record<string, number> & { age: number };

/**
 * A required distribution the year did not need is withdrawn and paid straight
 * back into the taxable bucket. It never reaches the household, and at the ages
 * where RMDs are large it is most of the gross draw, so leaving it in would let
 * an account transfer bury the spending the chart exists to show. Its tax
 * still lands on the outflow side, which is the part the plan actually feels.
 *
 * Draining Traditional first is where a required distribution comes from.
 */
function netWithdrawals(row: OutcomeCashFlowRow): Record<string, number> {
  const buckets = {
    withdrawalTraditional: row.withdrawalTraditional,
    withdrawalTaxable: row.withdrawalTaxable,
    withdrawalRoth: row.withdrawalRoth,
    withdrawalHSA: row.withdrawalHSA,
  };
  const gross = Object.values(buckets).reduce((sum, value) => sum + value, 0);
  let reinvested = Math.max(0, gross - Math.max(0, -row.savings));
  for (const key of Object.keys(buckets) as (keyof typeof buckets)[]) {
    const applied = Math.min(reinvested, buckets[key]);
    buckets[key] -= applied;
    reinvested -= applied;
  }
  return buckets;
}

function total(row: Row, series: Series[]) {
  return series.reduce((sum, s) => sum + row[s.key], 0);
}

function Legend({ groups }: { groups: { name: string; series: Series[] }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pb-3 text-xs">
      {groups.map((group) => (
        <div key={group.name} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
            {group.name}
          </span>
          {group.series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 flex-none rounded-[3px]"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Panel({
  caption,
  data,
  series,
  height,
  yScale,
  xTicks,
  retirementAge,
  markRetirement,
  reversed,
  showAxis,
  label,
}: {
  caption: string;
  data: Row[];
  series: Series[];
  height: number;
  yScale: { domain: [number, number]; ticks: number[] };
  xTicks: number[];
  retirementAge?: number;
  markRetirement?: boolean;
  reversed?: boolean;
  showAxis?: boolean;
  label: string;
}) {
  return (
    <div className="flex">
      <span className="text-muted-foreground flex w-4 flex-none items-center justify-center font-mono text-[10px] tracking-widest uppercase [writing-mode:vertical-rl] rotate-180">
        {caption}
      </span>
      <ChartContainer
        config={config}
        className="aspect-auto min-w-0 flex-1"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        <AreaChart
          accessibilityLayer
          data={data}
          syncId="cash-flow"
          // The ticks at both ends of the domain sit on the plot edge, so each
          // panel needs room or they clip away.
          margin={{ top: 10, right: 12, left: 0, bottom: showAxis ? 0 : 10 }}
        >
          <CartesianGrid {...chartGridProps} />
          <XAxis
            {...chartXAxisProps}
            dataKey="age"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={xTicks}
            hide={!showAxis}
          />
          <YAxis
            {...chartYAxisProps}
            domain={yScale.domain}
            ticks={yScale.ticks}
            reversed={reversed}
            tickFormatter={fmtAxisCurrency}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              // A plan changes on birthdays. Interpolating between years would
              // draw transitions the engine never models.
              type="step"
              dataKey={s.key}
              stackId="1"
              stroke="var(--color-card)"
              strokeWidth={1}
              fill={s.color}
              fillOpacity={1}
              isAnimationActive={false}
            />
          ))}
          {retirementAge != null && (
            <ReferenceLine
              x={retirementAge}
              stroke="var(--color-foreground)"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              label={markRetirement ? {
                value: "RETIRE",
                position: "insideTopLeft",
                offset: 6,
                fill: "var(--color-muted-foreground)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
              } : undefined}
            />
          )}
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
                    <span>{caption}</span>
                    <span className="font-mono tabular-nums">
                      {fmtCurrency(
                        payload.reduce((sum, item) => sum + Number(item.value ?? 0), 0),
                        true,
                      )}
                    </span>
                  </span>
                )}
              />
            }
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

export function CashFlowChart({
  projections,
  height = 380,
}: {
  projections: OutcomeCashFlowRow[];
  height?: number;
}) {
  const data = useMemo<Row[]>(
    () => projections.map((row) => ({
      age: row.age,
      // In retirement `income` is the Social Security benefit, which the
      // benefit series already stacks.
      earnedIncome: row.isRetired ? 0 : row.income,
      socialSecurityBenefit: row.socialSecurityBenefit,
      ...netWithdrawals(row),
      living: Math.max(0, row.spending - row.healthcareCost),
      healthcareCost: row.healthcareCost,
      taxes: row.taxes,
      saved: Math.max(0, row.savings),
    })),
    [projections],
  );

  // One scale for both panels. Money in equals money out every year, so
  // separate scales would make an identity look like a difference.
  const yScale = useMemo(
    () => niceLinearScale(Math.max(
      0,
      ...data.map((row) => Math.max(total(row, inflow), total(row, outflow))),
    )),
    [data],
  );
  const xTicks = useMemo(
    () => ageTicks(data[0]?.age ?? 0, data[data.length - 1]?.age ?? 0),
    [data],
  );
  // A plan with no HSA, or a filter with no retired years, should not carry a
  // legend entry for a band the chart never draws.
  const [inSeries, outSeries] = useMemo(
    () => [inflow, outflow].map(
      (group) => group.filter((s) => data.some((row) => row[s.key] > 0)),
    ),
    [data],
  );
  // Only meaningful when the filter keeps both phases; one phase alone has no
  // boundary to mark.
  const retirementAge = useMemo(() => {
    const index = projections.findIndex((row) => row.isRetired);
    return index > 0 ? projections[index].age : undefined;
  }, [projections]);

  if (data.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center text-sm"
        style={{ height }}
      >
        No years in this filter
      </div>
    );
  }

  const panelHeight = (height - 28) / 2;

  return (
    <div className="flex flex-col gap-2">
      <Legend
        groups={[
          { name: "In", series: inSeries },
          { name: "Out", series: outSeries },
        ]}
      />
      <Panel
        caption="Money in"
        data={data}
        series={inSeries}
        height={panelHeight}
        yScale={yScale}
        xTicks={xTicks}
        retirementAge={retirementAge}
        markRetirement
        label="Average annual money in by source for the selected outcome range"
      />
      <Panel
        caption="Money out"
        data={data}
        series={outSeries}
        height={panelHeight + 28}
        yScale={yScale}
        xTicks={xTicks}
        retirementAge={retirementAge}
        reversed
        showAxis
        label="Average annual money out by category for the selected outcome range"
      />
    </div>
  );
}
