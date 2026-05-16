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
  WealthFanChart,
} from "@/components/ui/charts";
import { fmtCurrency } from "../format";
import { cn } from "@/lib/utils";

type ChartView = "wealth" | "income";
type YearFilter = "all" | "work" | "retired";

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
        header: () => <span className="block text-right">Range</span>,
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

  const successProb = result?.successProbability ?? 0;
  const median = result?.medianTerminalWealth ?? 0;
  const p10 = result?.percentile10TerminalWealth ?? 0;
  const p90 = result?.percentile90TerminalWealth ?? 0;

  return (
    <PageShell>
      <PageHeader
        title="Projections"
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
          label="Median wealth"
          value={fmtCurrency(median, true)}
          trend={`at age ${plan.profile.lifeExpectancy}`}
        />
        <Stat
          label="Downside (10th %)"
          value={fmtCurrency(p10, true)}
          tone="warn"
        />
        <Stat
          label="Upside (90th %)"
          value={fmtCurrency(p90, true)}
          tone="positive"
        />
      </KPIGrid>

      <DashboardCard
        title={view === "wealth" ? "Wealth Trajectory" : "Income Sources"}
        actions={
          <SegmentedTabs<ChartView>
            value={view}
            onValueChange={setView}
            options={[
              { value: "wealth", label: "Trajectory" },
              { value: "income", label: "Income sources" },
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
        ) : (
          <IncomeSourcesChart
            projections={result?.incomeSourcesPath ?? yearly}
            height={300}
          />
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
