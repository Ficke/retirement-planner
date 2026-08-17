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
import type { SimulationResult, YearlyProjection } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  SegmentedTabs,
  Stat,
} from "@/components/retire/ui";
import {
  IncomeSourcesChart,
  WealthFanChart,
} from "@/components/ui/charts";
import { fmtCurrency, successTone } from "../format";
import { cn } from "@/lib/utils";

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
        header: () => <span className="block text-right">Median portfolio</span>,
        cell: ({ getValue }) => (
          <span className="block text-right font-mono font-semibold">
            {fmtCurrency(getValue<number>(), true)}
          </span>
        ),
      },
      {
        id: "range",
        header: () => <span className="block text-right">Middle 50%</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground block text-right font-mono text-xs">
            {fmtCurrency(row.original.p25, true)} / {fmtCurrency(row.original.p75, true)}
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

const OUTCOME_PERCENTILES = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

function OutcomeSelect({
  value,
  onValueChange,
}: {
  value: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onValueChange(Number(next))}>
      <SelectTrigger size="sm" className="w-[196px]" aria-label="Outcome percentile">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OUTCOME_PERCENTILES.map((percentile) => (
          <SelectItem key={percentile} value={String(percentile)}>
            {percentile === 50
              ? "Median · 45th–55th"
              : `${percentile - 5}th–${percentile + 5}th`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProjectionSummary({
  result,
}: {
  result: SimulationResult | null;
}) {
  const plan = usePlan((s) => s.plan);
  const currentWealth = plan.accounts.reduce(
    (total, account) => total + account.balance,
    0,
  );
  const retirementProjection = result?.yearlyProjections.find(
    (projection) => projection.age === plan.profile.retirementAge,
  );
  const successProb = result?.successProbability;
  const retirementWealth = retirementProjection?.p50;
  const finalWealth = result?.medianTerminalWealth;

  return (
    <KPIGrid cols={4}>
      <Stat
        label="Current wealth"
        value={fmtCurrency(currentWealth, true)}
        trend="Account balances today"
      />
      <Stat
        label="Chance of success"
        value={successProb == null ? "—" : `${(successProb * 100).toFixed(0)}%`}
        trend={successProb == null ? "Simulation pending" : successTone(successProb).label}
        tone={successProb == null ? undefined : successTone(successProb).tone}
      />
      <Stat
        label="Projected wealth at retirement"
        value={retirementWealth == null ? "—" : fmtCurrency(retirementWealth, true)}
        trend={`Median projection at age ${plan.profile.retirementAge}`}
      />
      <Stat
        label={`Projected wealth at age ${plan.profile.lifeExpectancy}`}
        value={finalWealth == null ? "—" : fmtCurrency(finalWealth, true)}
        trend="Median projection"
      />
    </KPIGrid>
  );
}

export function ProjectionDetails({
  result,
  isSimulating,
}: {
  result: SimulationResult | null;
  isSimulating: boolean;
}) {
  const plan = usePlan((s) => s.plan);

  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const [outcomePercentile, setOutcomePercentile] = useState(50);

  const selectedBucket = useMemo(
    () => result?.outcomeBuckets?.find(
      (bucket) => bucket.centerPercentile === outcomePercentile,
    ),
    [outcomePercentile, result?.outcomeBuckets],
  );

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
    const cashFlowsByAge = new Map(
      selectedBucket?.projections.map((projection) => [projection.age, projection]),
    );
    return filtered.map((p) => {
      const cashFlow = cashFlowsByAge.get(p.age);
      return {
        ...p,
        income: cashFlow?.income ?? p.income,
        spending: cashFlow?.spending ?? p.spending,
        taxes: cashFlow?.taxes ?? p.taxes,
        savings: cashFlow?.savings ?? p.savings,
        externalIncome: cashFlow?.income ?? p.income,
      };
    });
  }, [selectedBucket?.projections, yearly, yearFilter]);

  return (
    <>
      <DashboardCard title="Wealth over time">
        {!yearly.length ? (
          <div className="text-muted-foreground flex h-[340px] items-center justify-center text-sm">
            {isSimulating
              ? "Running simulation…"
              : "No projection data — adjust your plan to run."}
          </div>
        ) : (
          <WealthFanChart
            projections={yearly}
            retirementAge={plan.profile.retirementAge}
            height={340}
          />
        )}
      </DashboardCard>

      <DashboardCard
        title="Retirement cash flow"
        description={selectedBucket
          ? `Average annual income sources for outcomes in the ${selectedBucket.lowerPercentile}th–${selectedBucket.upperPercentile}th percentile of terminal wealth.`
          : undefined}
        actions={selectedBucket
          ? <OutcomeSelect value={outcomePercentile} onValueChange={setOutcomePercentile} />
          : undefined}
      >
        {!yearly.length ? (
          <div className="text-muted-foreground flex h-[320px] items-center justify-center text-sm">
            {isSimulating
              ? "Running simulation…"
              : "No projection data — adjust your plan to run."}
          </div>
        ) : (
          <IncomeSourcesChart
            projections={selectedBucket?.projections ?? result?.incomeSourcesPath ?? yearly}
            height={320}
          />
        )}
      </DashboardCard>

      <DashboardCard
        title="Year by year"
        description={selectedBucket
          ? `Cash flows average the ${selectedBucket.lowerPercentile}th–${selectedBucket.upperPercentile}th percentile outcome cohort. Portfolio is the median; Middle 50% is the 25th–75th percentile range.`
          : "Cash flows follow one representative path. Portfolio is the median; Middle 50% is the 25th–75th percentile range."}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedBucket && (
              <OutcomeSelect value={outcomePercentile} onValueChange={setOutcomePercentile} />
            )}
            <SegmentedTabs<YearFilter>
              value={yearFilter}
              onValueChange={setYearFilter}
              options={[
                { value: "all", label: "All years" },
                { value: "work", label: "Working" },
                { value: "retired", label: "Retired" },
              ]}
            />
          </div>
        }
        flush
      >
        <YearlyTable data={filteredRows} />
      </DashboardCard>
    </>
  );
}
