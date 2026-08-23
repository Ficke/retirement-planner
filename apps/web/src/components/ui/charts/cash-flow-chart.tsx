"use client";

import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
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
import { toCashFlowRows, type CashFlowRow } from "./cash-flow-data";

type Series = {
  key: string;
  label: string;
  color: string;
  stackId: "money-in" | "money-out";
};

const TRANSITION_EPSILON_YEARS = 0.01;

// Recharts classifies zero as positive under its sign offset. Separate
// one-sign stacks keep sparse outflows anchored below zero instead of at the
// top of the inflow stack.
const inflow: Series[] = [
  {
    key: "salary",
    label: "Salary",
    color: "var(--color-money-in-1)",
    stackId: "money-in",
  },
  {
    key: "socialSecurity",
    label: "Social Security",
    color: "var(--color-money-in-2)",
    stackId: "money-in",
  },
  {
    key: "portfolio",
    label: "Portfolio",
    color: "var(--color-money-in-3)",
    stackId: "money-in",
  },
];

const outflow: Series[] = [
  {
    key: "living",
    label: "Living",
    color: "var(--color-money-out-1)",
    stackId: "money-out",
  },
  {
    key: "healthcare",
    label: "Healthcare",
    color: "var(--color-money-out-2)",
    stackId: "money-out",
  },
  {
    key: "longTermCare",
    label: "Long-term care",
    color: "var(--color-money-out-3)",
    stackId: "money-out",
  },
  {
    key: "tax",
    label: "Tax",
    color: "var(--color-money-out-4)",
    stackId: "money-out",
  },
];

/**
 * Which account funded the year. Account source is orthogonal to expense type,
 * so it rides the tooltip instead of adding four more stacked hues to the plot.
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
]);

function total(row: CashFlowRow, series: Series[]) {
  return series.reduce((sum, s) => sum + row[s.key], 0);
}

function toDivergingRows(data: CashFlowRow[], transitionAges: number[]) {
  const transitions = new Set(transitionAges);
  return data.flatMap((row, index) => {
    const signedRow = {
      ...row,
      living: -row.living,
      healthcare: -row.healthcare,
      longTermCare: -row.longTermCare,
      tax: -row.tax,
    };
    const previous = data[index - 1];
    if (!previous || !transitions.has(row.age)) return [signedRow];

    // Keep the smooth interpolation inside each phase, but confine a milestone
    // discontinuity to a fraction of a pixel immediately before its age.
    return [{
      ...previous,
      age: row.age - TRANSITION_EPSILON_YEARS,
      displayAge: previous.age,
      living: -previous.living,
      healthcare: -previous.healthcare,
      longTermCare: -previous.longTermCare,
      tax: -previous.tax,
    }, signedRow];
  });
}

function Swatch({ color }: { color: string }) {
  return (
    <span className="size-2.5 flex-none rounded-[3px]" style={{ background: color }} />
  );
}

function TooltipDot({ color }: { color: string }) {
  return <span className="size-2 flex-none rounded-full" style={{ background: color }} />;
}

function Legend({
  groups,
}: {
  groups: { name: string; color: string; series: Series[] }[];
}) {
  return (
    <div className="flex flex-col gap-2 px-1 pb-3 text-xs">
      {groups.map((group) => (
        <div key={group.name} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-muted-foreground flex w-20 flex-none items-center gap-2 font-medium">
            <span
              className="h-4 w-0.5 rounded-full"
              style={{ background: group.color }}
              aria-hidden
            />
            <span>{group.name}</span>
          </span>
          {group.series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <Swatch color={s.color} />
              {s.label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function CashFlowPlot({
  data,
  height,
  yScale,
  xTicks,
  retirementAge,
  rmdStartAge,
}: {
  data: CashFlowRow[];
  height: number;
  yScale: { domain: [number, number]; ticks: number[] };
  xTicks: number[];
  retirementAge?: number;
  rmdStartAge?: number;
}) {
  const singleYear = data.length === 1;
  const xDomain: [number, number] | ["dataMin", "dataMax"] = singleYear
    ? [data[0].age - 0.5, data[0].age + 0.5]
    : ["dataMin", "dataMax"];
  const maximum = yScale.domain[1];
  const yTicks = [
    ...yScale.ticks.slice(1).reverse().map((tick) => -tick),
    ...yScale.ticks,
  ];

  return (
    <div className="flex">
      <div
        className="text-muted-foreground flex w-4 flex-none flex-col font-mono text-[10px] tracking-widest uppercase"
        aria-hidden
      >
        <span className="flex flex-1 items-center justify-center [writing-mode:vertical-rl] rotate-180">
          Money in
        </span>
        <span className="flex flex-1 items-center justify-center [writing-mode:vertical-rl] rotate-180">
          Money out
        </span>
      </div>
      <ChartContainer
        config={config}
        className="aspect-auto min-w-0 flex-1"
        style={{ height }}
        role="img"
        aria-label="Average annual money in by source and money out by category for the selected outcome range"
      >
        <ComposedChart
          accessibilityLayer
          data={data}
          margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...chartGridProps} />
          <XAxis
            {...chartXAxisProps}
            dataKey="age"
            type="number"
            domain={xDomain}
            ticks={xTicks}
          />
          <YAxis
            {...chartYAxisProps}
            domain={[-maximum, maximum]}
            ticks={yTicks}
            tickFormatter={(value) => fmtAxisCurrency(Math.abs(Number(value)))}
          />
          {[...inflow, ...outflow].map((s) => singleYear ? (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={s.stackId}
              barSize={48}
              fill={s.color}
              isAnimationActive={false}
            />
          ) : (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stackId={s.stackId}
              stroke="none"
              fill={s.color}
              fillOpacity={1}
              isAnimationActive={false}
            />
          ))}
          <ReferenceLine
            y={0}
            stroke="var(--color-foreground)"
            strokeOpacity={0.35}
          />
          {retirementAge != null && (
            <ReferenceLine
              x={retirementAge}
              stroke="var(--color-foreground)"
              strokeOpacity={0.35}
              label={{
                value: "RETIRE",
                position: "insideTopLeft",
                offset: 6,
                fill: "var(--color-muted-foreground)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            />
          )}
          {rmdStartAge != null && (
            <ReferenceLine
              x={rmdStartAge}
              stroke="var(--color-foreground)"
              strokeDasharray="3 3"
              strokeOpacity={0.35}
              label={{
                value: "RMD",
                position: "insideTopLeft",
                offset: 6,
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
                hideZeroValues
                labelFormatter={(_label, payload) => {
                  const age = payload?.[0]?.payload?.displayAge
                    ?? payload?.[0]?.payload?.age;
                  return age != null ? `Age ${age}` : "";
                }}
                formatter={(value, name, item) => {
                  const row = item?.payload as CashFlowRow | undefined;
                  const split = name === "portfolio" && row
                    ? buckets.filter((b) => row[b.key] > 0)
                    : [];
                  const startsOutflowSection = name === outflow[0].key;
                  return (
                    <span
                      className={`flex w-full flex-col gap-0.5 ${
                        startsOutflowSection
                          ? "border-border/60 mt-1 border-t pt-2"
                          : ""
                      }`}
                    >
                      <span className="flex w-full justify-between gap-4">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <TooltipDot
                            color={String(
                              item.color ?? "var(--color-muted-foreground)",
                            )}
                          />
                          {config[name as string]?.label ?? String(name)}
                        </span>
                        <span className="font-mono tabular-nums">
                          {fmtCurrency(Math.abs(Number(value)), true)}
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
                  const row = payload[0]?.payload as CashFlowRow | undefined;
                  if (!row) return null;
                  const moneyIn = total(row, inflow);
                  const moneyOut = Math.abs(total(row, outflow));
                  return (
                    <span className="flex w-full flex-col gap-0.5">
                      <span className="flex w-full justify-between gap-4 font-medium">
                        <span>Money in</span>
                        <span className="font-mono tabular-nums">
                          {fmtCurrency(moneyIn, true)}
                        </span>
                      </span>
                      <span className="flex w-full justify-between gap-4 font-medium">
                        <span>Money out</span>
                        <span className="font-mono tabular-nums">
                          {fmtCurrency(moneyOut, true)}
                        </span>
                      </span>
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
  rmdStartAge,
  partialYear,
}: {
  projections: OutcomeCashFlowRow[];
  height?: number;
  rmdStartAge?: number;
  partialYear?: { age: number; fraction: number };
}) {
  const data = useMemo(
    () => toCashFlowRows(projections, partialYear),
    [partialYear, projections],
  );

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
  const visibleRmdStartAge = rmdStartAge != null
    && rmdStartAge >= data[0]?.age
    && rmdStartAge <= data[data.length - 1]?.age
    ? rmdStartAge
    : undefined;
  const chartData = useMemo(
    () => toDivergingRows(
      data,
      [retirementAge, visibleRmdStartAge].filter((age): age is number => age != null),
    ),
    [data, retirementAge, visibleRmdStartAge],
  );

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

  return (
    <div className="flex flex-col">
      <Legend
        groups={[
          { name: "Money in", color: "var(--color-money-in)", series: inSeries },
          { name: "Money out", color: "var(--color-money-out)", series: outSeries },
        ]}
      />
      <CashFlowPlot
        data={chartData}
        height={height}
        yScale={yScale}
        xTicks={xTicks}
        retirementAge={retirementAge}
        rmdStartAge={visibleRmdStartAge}
      />
    </div>
  );
}
