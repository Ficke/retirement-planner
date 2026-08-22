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
import type { OutcomeCashFlowRow } from "@/domain/types";

type Series = { key: string; label: string; color: string };

const inflow: Series[] = [
  { key: "salary", label: "Salary", color: "var(--color-flow-salary)" },
  { key: "socialSecurity", label: "Social Security", color: "var(--color-flow-social)" },
  { key: "portfolio", label: "Portfolio", color: "var(--color-flow-portfolio)" },
];

const outflow: Series[] = [
  { key: "living", label: "Living", color: "var(--color-flow-living)" },
  { key: "healthcare", label: "Healthcare", color: "var(--color-flow-healthcare)" },
  { key: "tax", label: "Tax", color: "var(--color-flow-tax)" },
];

/**
 * Which account the year was funded from. A fourth stacked hue per side is
 * past the count a stack can carry, so this rides the tooltip instead of the
 * plot — the chart answers "how much came out of the portfolio", and the
 * tooltip answers "out of which bucket".
 */
const buckets: { key: string; label: string }[] = [
  { key: "fromTaxable", label: "Taxable" },
  { key: "fromTraditional", label: "Traditional" },
  { key: "fromRoth", label: "Roth" },
  { key: "fromHSA", label: "HSA" },
];

const config = Object.fromEntries([
  ...[...inflow, ...outflow].map((s) => [s.key, { label: s.label, color: s.color }]),
  ...buckets.map((b) => [b.key, { label: b.label }]),
  ["moneyIn", { label: "Money in" }],
]);

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
function netWithdrawals(row: OutcomeCashFlowRow) {
  const drawn = {
    fromTraditional: row.withdrawalTraditional,
    fromTaxable: row.withdrawalTaxable,
    fromRoth: row.withdrawalRoth,
    fromHSA: row.withdrawalHSA,
  };
  const gross = Object.values(drawn).reduce((sum, value) => sum + value, 0);
  let reinvested = Math.max(0, gross - Math.max(0, -row.savings));
  for (const key of Object.keys(drawn) as (keyof typeof drawn)[]) {
    const applied = Math.min(reinvested, drawn[key]);
    drawn[key] -= applied;
    reinvested -= applied;
  }
  const portfolio = Object.values(drawn).reduce((sum, value) => sum + value, 0);
  return { ...drawn, portfolio };
}

function total(row: Row, series: Series[]) {
  return series.reduce((sum, s) => sum + row[s.key], 0);
}

function Swatch({ color }: { color: string }) {
  return (
    <span className="size-2.5 flex-none rounded-[3px]" style={{ background: color }} />
  );
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
              <Swatch color={s.color} />
              {s.label}
            </span>
          ))}
        </div>
      ))}
      <span className="text-muted-foreground flex items-center gap-1.5">
        <svg width="14" height="10" aria-hidden className="flex-none">
          <line x1="0" y1="5" x2="14" y2="5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Money in — what it clears is saved
      </span>
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
  showIncomeLine,
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
  showIncomeLine?: boolean;
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
        <ComposedChart
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
              type="monotone"
              dataKey={s.key}
              stackId="1"
              stroke="none"
              fill={s.color}
              fillOpacity={1}
              isAnimationActive={false}
            />
          ))}
          {showIncomeLine && (
            <Line
              type="monotone"
              dataKey="moneyIn"
              // Solid, because the gridlines are already dashed and two dashed
              // rules meaning different things read as one.
              stroke="var(--color-foreground)"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {retirementAge != null && (
            <ReferenceLine
              x={retirementAge}
              stroke="var(--color-foreground)"
              strokeOpacity={0.35}
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
                formatter={(value, name, item) => {
                  const row = item?.payload as Row | undefined;
                  const split = name === "portfolio" && row
                    ? buckets.filter((b) => row[b.key] > 0)
                    : [];
                  return (
                    <span className="flex w-full flex-col gap-0.5">
                      <span className="flex w-full justify-between gap-4">
                        <span className="text-muted-foreground">
                          {config[name as string]?.label ?? String(name)}
                        </span>
                        <span className="font-mono tabular-nums">
                          {fmtCurrency(Number(value), true)}
                        </span>
                      </span>
                      {split.map((b) => (
                        <span
                          key={b.key}
                          className="text-muted-foreground flex w-full justify-between gap-4 pl-2 text-[11px]"
                        >
                          <span>{b.label}</span>
                          <span className="font-mono tabular-nums">
                            {fmtCurrency(row![b.key], true)}
                          </span>
                        </span>
                      ))}
                    </span>
                  );
                }}
                footer={(payload) => {
                  const row = payload[0]?.payload;
                  const sum = payload
                    .filter((item) => item.dataKey !== "moneyIn")
                    .reduce((acc, item) => acc + Number(item.value ?? 0), 0);
                  const saved = row?.saved ?? 0;
                  return (
                    <span className="flex w-full flex-col gap-0.5">
                      <span className="flex w-full justify-between gap-4 font-medium">
                        <span>{caption}</span>
                        <span className="font-mono tabular-nums">
                          {fmtCurrency(sum, true)}
                        </span>
                      </span>
                      {showIncomeLine && saved > 0 && (
                        <span className="text-muted-foreground flex w-full justify-between gap-4">
                          <span>Saved</span>
                          <span className="font-mono tabular-nums">
                            {fmtCurrency(saved, true)}
                          </span>
                        </span>
                      )}
                    </span>
                  );
                }}
              />
            }
          />
        </ComposedChart>
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
    () => projections.map((row) => {
      const drawn = netWithdrawals(row);
      const salary = row.isRetired ? 0 : row.income;
      return {
        age: row.age,
        salary,
        socialSecurity: row.socialSecurityBenefit,
        ...drawn,
        living: Math.max(0, row.spending - row.healthcareCost),
        healthcare: row.healthcareCost,
        tax: row.taxes,
        // Every dollar in is spent, taxed, or kept, so what the outflow stack
        // leaves under this line is exactly the year's saving. Drawing it as a
        // band instead would file saving under money spent.
        moneyIn: salary + row.socialSecurityBenefit + drawn.portfolio,
        saved: Math.max(0, row.savings),
      };
    }),
    [projections],
  );

  // One scale for both panels. Separate scales would make the gap between them
  // — the part that carries the saving — unreadable.
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
  // A filter with no retired years should not carry a legend entry for a band
  // the chart never draws.
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
        showIncomeLine
        label="Average annual money out by category for the selected outcome range, against the money that came in"
      />
    </div>
  );
}
