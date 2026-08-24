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
import type { RetirementPlan, SimulationResult, YearlyProjection } from "@/domain/types";
import { birthYearOf, remainingYearFractionOf } from "@/domain/age";
import { getRmdStartAge } from "@/data/rmd-tables";
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
  CashFlowChart,
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
          <span className="text-money-in block text-right font-mono">
            {fmtCurrency(getValue<number>(), true)}
          </span>
        ),
      },
      {
        accessorKey: "spending",
        header: () => <span className="block text-right">Spending</span>,
        cell: ({ getValue }) => (
          <span className="text-money-out block text-right font-mono">
            −{fmtCurrency(getValue<number>(), true)}
          </span>
        ),
      },
      {
        accessorKey: "taxes",
        header: () => <span className="block text-right">Taxes</span>,
        cell: ({ getValue }) => (
          <span className="text-money-out block text-right font-mono">
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

const OUTCOME_PERCENTILES = [10, 30, 50, 70, 90] as const;

const OUTCOME_LABELS: Record<(typeof OUTCOME_PERCENTILES)[number], string> = {
  10: "Downside",
  30: "Unfavorable",
  50: "Median",
  70: "Favorable",
  90: "Strong upside",
};

function outcomeLabel(percentile: number): string {
  return OUTCOME_LABELS[percentile as keyof typeof OUTCOME_LABELS] ?? `P${percentile}`;
}

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
            {outcomeLabel(percentile)} · {percentile - 5}th–{percentile + 5}th
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function YearFilterTabs({
  value,
  onValueChange,
}: {
  value: YearFilter;
  onValueChange: (value: YearFilter) => void;
}) {
  return (
    <SegmentedTabs<YearFilter>
      value={value}
      onValueChange={onValueChange}
      options={[
        { value: "all", label: "All years" },
        { value: "work", label: "Working" },
        { value: "retired", label: "Retired" },
      ]}
    />
  );
}

export function ProjectionSummary({
  result,
  resultPlan,
  isCalculating = false,
}: {
  result: SimulationResult | null;
  resultPlan: RetirementPlan | null;
  isCalculating?: boolean;
}) {
  const plan = usePlan((s) => s.plan);
  const currentWealth = plan.accounts.reduce(
    (total, account) => total + account.balance,
    0,
  );
  // Ages come from the plan the result was computed from. Reading the live
  // plan's ages out of an older run reports a year it never projected.
  const retirementAge = resultPlan?.profile.retirementAge;
  const retirementProjection = result?.yearlyProjections.find(
    (projection) => projection.age === retirementAge,
  );
  const successProb = result?.successProbability;
  const retirementWealth = retirementProjection?.p50;
  const finalWealth = result?.medianTerminalWealth;
  const finalWealthAfterTax = result?.medianAfterTaxTerminalWealth;

  return (
    <KPIGrid cols={4}>
      <Stat
        label="Current wealth"
        value={fmtCurrency(currentWealth, true)}
        trend="Account balances today"
      />
      <Stat
        label="Modeled plan success"
        value={successProb == null ? "—" : `${(successProb * 100).toFixed(0)}%`}
        trend={successProb == null ? "Simulation pending" : successTone(successProb).label}
        tone={successProb == null ? undefined : successTone(successProb).tone}
        pending={isCalculating}
      />
      <Stat
        label="Median wealth at retirement"
        value={retirementWealth == null ? "—" : fmtCurrency(retirementWealth, true)}
        trend={retirementAge == null
          ? "Modeled outcome"
          : `Modeled outcome at age ${retirementAge}`}
        pending={isCalculating}
      />
      <Stat
        label={`Median wealth at age ${(resultPlan ?? plan).profile.lifeExpectancy}`}
        value={finalWealth == null ? "—" : fmtCurrency(finalWealth, true)}
        trend={finalWealthAfterTax == null
          ? "Modeled outcome"
          : `${fmtCurrency(finalWealthAfterTax, true)} after tax on pre-tax balances`}
        pending={isCalculating}
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
    () => result?.outcomeBuckets.find(
      (bucket) => bucket.centerPercentile === outcomePercentile,
    ),
    [outcomePercentile, result?.outcomeBuckets],
  );

  const yearly = useMemo(
    () => result?.yearlyProjections ?? [],
    [result?.yearlyProjections],
  );
  const inFilter = useMemo(
    () => (row: { isRetired: boolean }) => (
      yearFilter === "work" ? !row.isRetired : yearFilter === "retired" ? row.isRetired : true
    ),
    [yearFilter],
  );
  const cashFlowRows = useMemo(
    () => (selectedBucket?.projections ?? []).filter(inFilter),
    [inFilter, selectedBucket?.projections],
  );
  const filteredRows = useMemo<Row[]>(() => {
    const filtered = yearly.filter(inFilter);
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
  }, [selectedBucket?.projections, yearly, inFilter]);

  return (
    <>
      <DashboardCard title="Wealth over time">
        {!yearly.length ? (
          <div className="text-muted-foreground flex h-[340px] items-center justify-center text-sm">
            {isSimulating
              ? "Running simulation…"
              : "No projection data. Adjust your plan to run."}
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
        title="Cash flow"
        description={selectedBucket
          ? `Average annual cash flows for the ${outcomeLabel(selectedBucket.centerPercentile).toLowerCase()} outcome group (${selectedBucket.lowerPercentile}th–${selectedBucket.upperPercentile}th percentile of terminal wealth).`
          : undefined}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedBucket && (
              <OutcomeSelect value={outcomePercentile} onValueChange={setOutcomePercentile} />
            )}
            <YearFilterTabs value={yearFilter} onValueChange={setYearFilter} />
          </div>
        }
      >
        {!yearly.length ? (
          <div className="text-muted-foreground flex h-[400px] items-center justify-center text-sm">
            {isSimulating
              ? "Running simulation…"
              : "No projection data. Adjust your plan to run."}
          </div>
        ) : (
          <CashFlowChart
            projections={cashFlowRows}
            height={400}
            rmdStartAge={getRmdStartAge(birthYearOf(plan.profile.birthDate))}
            partialYear={selectedBucket?.projections[0] ? {
              age: selectedBucket.projections[0].age,
              fraction: remainingYearFractionOf(plan.profile.asOfDate),
            } : undefined}
          />
        )}
      </DashboardCard>

      <DashboardCard
        title="Year by year"
        description={selectedBucket
          ? `Cash flows use the ${outcomeLabel(selectedBucket.centerPercentile).toLowerCase()} outcome group. Portfolio is the median. Middle 50% spans the 25th–75th percentiles.`
          : "Portfolio is the median. Middle 50% spans the 25th–75th percentiles."}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedBucket && (
              <OutcomeSelect value={outcomePercentile} onValueChange={setOutcomePercentile} />
            )}
            <YearFilterTabs value={yearFilter} onValueChange={setYearFilter} />
          </div>
        }
        flush
      >
        <YearlyTable data={filteredRows} />
      </DashboardCard>
    </>
  );
}
