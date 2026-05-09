"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { usePlan } from "@/state/usePlan";
import {
  US_STOCK_REAL_RETURNS_1926_2024,
  US_BOND_REAL_RETURNS_1926_2024,
  US_INFLATION_1926_2024,
  ASSET_CORRELATION_MATRIX_1926_2024,
} from "@/data/market-history";
import type { YearlyProjection } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DashboardCard,
  KPIGrid,
  PageHeader,
  PageShell,
  SegmentedTabs,
  Stat,
} from "@/components/retire/ui";
import {
  IncomeSourcesChart,
  PercentileBars,
  WealthFanChart,
} from "@/components/ui/charts";
import { fmtCurrency } from "../format";
import { cn } from "@/lib/utils";

type ChartView = "wealth" | "income" | "percentiles";
type YearFilter = "all" | "work" | "retired";

const STOCK_MEAN = US_STOCK_REAL_RETURNS_1926_2024.mean;
const STOCK_VOL = US_STOCK_REAL_RETURNS_1926_2024.volatility;
const BOND_MEAN = US_BOND_REAL_RETURNS_1926_2024.mean;
const BOND_VOL = US_BOND_REAL_RETURNS_1926_2024.volatility;
const INFLATION_MEAN = US_INFLATION_1926_2024.mean;
const STOCK_BOND_CORR = ASSET_CORRELATION_MATRIX_1926_2024.stocks_bonds;

function ModelStrip({
  expectedReturn,
  expectedVol,
  inflation,
  horizon,
}: {
  expectedReturn: number;
  expectedVol: number;
  inflation: number;
  horizon: number;
}) {
  const items = [
    { label: "Expected return", value: `${expectedReturn.toFixed(1)}%` },
    { label: "Expected volatility", value: `${expectedVol.toFixed(1)}%` },
    { label: "Inflation", value: `${(inflation * 100).toFixed(1)}%` },
    { label: "Horizon", value: `${horizon} yrs` },
  ];
  return (
    <div className="bg-muted/40 border-border flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-2.5 text-xs">
      <Badge variant="secondary" className="text-[10px] tracking-wider uppercase">
        Model
      </Badge>
      {items.map((it) => (
        <span key={it.label} className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">{it.label}</span>
          <span className="text-foreground font-mono font-semibold">{it.value}</span>
        </span>
      ))}
      <span className="text-muted-foreground ml-auto italic">From Assumptions</span>
    </div>
  );
}

type Row = YearlyProjection & { externalIncome: number };

function YearlyTable({ data }: { data: Row[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "age", desc: false },
  ]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "age",
        header: "Age",
        cell: ({ getValue }) => (
          <span className="font-mono font-semibold">{getValue<number>()}</span>
        ),
      },
      {
        accessorKey: "isRetired",
        header: "Phase",
        enableSorting: false,
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <Badge variant="secondary" className="bg-info/15 text-info">
              Retired
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-success/15 text-success">
              Working
            </Badge>
          ),
      },
      {
        accessorKey: "externalIncome",
        header: () => <span className="block text-right">Income</span>,
        cell: ({ getValue }) => (
          <span className="block text-right font-mono">
            {fmtCurrency(getValue<number>(), true)}
          </span>
        ),
      },
      {
        accessorKey: "spending",
        header: () => <span className="block text-right">Spending</span>,
        cell: ({ getValue }) => (
          <span className="text-danger block text-right font-mono">
            −{fmtCurrency(getValue<number>(), true)}
          </span>
        ),
      },
      {
        accessorKey: "taxes",
        header: () => <span className="block text-right">Taxes</span>,
        cell: ({ getValue }) => (
          <span className="text-danger block text-right font-mono">
            −{fmtCurrency(getValue<number>(), true)}
          </span>
        ),
      },
      {
        accessorKey: "savings",
        header: () => <span className="block text-right">Net Saved</span>,
        cell: ({ getValue }) => {
          const v = getValue<number>();
          return (
            <span
              className={cn(
                "block text-right font-mono",
                v >= 0 ? "text-success" : "text-danger",
              )}
            >
              {v >= 0 ? "+" : ""}
              {fmtCurrency(v, true)}
            </span>
          );
        },
      },
      {
        accessorKey: "portfolioValue",
        header: () => <span className="block text-right">Portfolio</span>,
        cell: ({ getValue }) => (
          <span className="block text-right font-mono font-semibold">
            {fmtCurrency(getValue<number>(), true)}
          </span>
        ),
      },
      {
        id: "range",
        header: () => <span className="block text-right">P10 / P90</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground block text-right font-mono text-xs">
            {fmtCurrency(row.original.p10, true)} / {fmtCurrency(row.original.p90, true)}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        No years in this filter.
      </div>
    );
  }

  return (
    <div className="max-h-[480px] overflow-auto">
      <Table>
        <TableHeader className="bg-card sticky top-0 z-10">
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort();
                const sorted = h.column.getIsSorted();
                return (
                  <TableHead key={h.id} className="text-muted-foreground">
                    {sortable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={h.column.getToggleSortingHandler()}
                        className="-ml-2 h-7 gap-1.5 px-2 font-medium"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </Button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function PageProjections() {
  const plan = usePlan((s) => s.plan);
  const result = usePlan((s) => s.simulationResult);
  const isSimulating = usePlan((s) => s.isSimulatingMain);

  const [view, setView] = useState<ChartView>("wealth");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");

  const yearly = useMemo(
    () => result?.yearlyProjections ?? [],
    [result?.yearlyProjections],
  );
  const filteredRows = useMemo<Row[]>(() => {
    const filtered =
      yearFilter === "work"
        ? yearly.filter((p) => !p.isRetired)
        : yearFilter === "retired"
        ? yearly.filter((p) => p.isRetired)
        : yearly;
    return filtered.map((p) => ({
      ...p,
      externalIncome: p.income + p.socialSecurityBenefit,
    }));
  }, [yearly, yearFilter]);

  const stockWeight = plan.accounts.length
    ? plan.accounts.reduce((s, a) => s + a.balance * a.assetWeights.stocks, 0) /
      Math.max(
        1,
        plan.accounts.reduce((s, a) => s + a.balance, 0),
      )
    : 0.6;
  const bondWeight = 1 - stockWeight;
  const expectedReturn = (STOCK_MEAN * stockWeight + BOND_MEAN * bondWeight) * 100;
  const expectedVol =
    Math.sqrt(
      Math.pow(STOCK_VOL * stockWeight, 2) +
        Math.pow(BOND_VOL * bondWeight, 2) +
        2 * stockWeight * bondWeight * STOCK_VOL * BOND_VOL * STOCK_BOND_CORR,
    ) * 100;
  const horizon = plan.profile.lifeExpectancy - plan.profile.age;

  const successProb = result?.successProbability ?? 0;
  const median = result?.medianTerminalWealth ?? 0;
  const p10 = result?.percentile10TerminalWealth ?? 0;
  const p90 = result?.percentile90TerminalWealth ?? 0;

  return (
    <PageShell>
      <PageHeader
        title="Projections"
        description={`Monte Carlo simulation from age ${plan.profile.age} to ${plan.profile.lifeExpectancy}.`}
        actions={
          <Badge
            variant="secondary"
            className={cn(
              "gap-1.5",
              isSimulating ? "bg-warn/15 text-warn" : "bg-success/15 text-success",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isSimulating ? "bg-warn" : "bg-success",
              )}
            />
            {isSimulating ? "Recalculating" : "Up to date"}
          </Badge>
        }
      />

      <ModelStrip
        expectedReturn={expectedReturn}
        expectedVol={expectedVol}
        inflation={INFLATION_MEAN}
        horizon={horizon}
      />

      <KPIGrid cols={4}>
        <Stat
          label="Success Probability"
          value={`${(successProb * 100).toFixed(0)}%`}
          trend={
            successProb >= 0.85
              ? "Excellent"
              : successProb >= 0.7
              ? "On track"
              : successProb >= 0.5
              ? "At risk"
              : "Off track"
          }
          tone={successProb >= 0.85 ? "positive" : successProb >= 0.7 ? "neutral" : "warn"}
        />
        <Stat
          label="Median Terminal Wealth"
          value={fmtCurrency(median, true)}
          trend={`at age ${plan.profile.lifeExpectancy}`}
        />
        <Stat
          label="P10 (worst 10%)"
          value={fmtCurrency(p10, true)}
          trend="downside scenario"
          tone="warn"
        />
        <Stat
          label="P90 (best 10%)"
          value={fmtCurrency(p90, true)}
          trend="upside scenario"
          tone="positive"
        />
      </KPIGrid>

      <DashboardCard
        title="Outcome Distribution"
        description="Projected portfolio value across percentiles"
        actions={
          <SegmentedTabs<ChartView>
            value={view}
            onValueChange={setView}
            options={[
              { value: "wealth", label: "Trajectory" },
              { value: "income", label: "Income sources" },
              { value: "percentiles", label: "Percentiles" },
            ]}
          />
        }
      >
        {!yearly.length ? (
          <div className="text-muted-foreground flex h-[340px] items-center justify-center text-sm">
            {isSimulating
              ? "Running simulation…"
              : "No projection data — adjust your plan to run."}
          </div>
        ) : view === "wealth" ? (
          <WealthFanChart
            projections={yearly}
            retirementAge={plan.profile.retirementAge}
            height={340}
          />
        ) : view === "income" ? (
          <IncomeSourcesChart projections={yearly} height={300} />
        ) : (
          <div className="px-4 py-6">
            <PercentileBars projections={yearly} />
          </div>
        )}
      </DashboardCard>

      <DashboardCard
        title="Year-by-Year"
        actions={
          <SegmentedTabs<YearFilter>
            value={yearFilter}
            onValueChange={setYearFilter}
            options={[
              { value: "all", label: "All years" },
              { value: "work", label: "Working" },
              { value: "retired", label: "Retired" },
            ]}
          />
        }
        flush
      >
        <YearlyTable data={filteredRows} />
      </DashboardCard>
    </PageShell>
  );
}
