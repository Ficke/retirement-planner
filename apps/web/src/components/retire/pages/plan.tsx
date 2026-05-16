"use client";

import { useId, useMemo, useState } from "react";

import { usePlan } from "@/state/usePlan";
import type { FilingStatus, State } from "@/domain/types";
import { calculateTax } from "@/engine/tax";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  PageHeader,
  PageShell,
} from "@/components/retire/ui";
import { fmtCurrency, fmtPercent } from "../format";
import { cn } from "@/lib/utils";

const STATE_OPTIONS: [State, string][] = [
  ["CA", "California"],
  ["TX", "Texas"],
  ["FL", "Florida"],
  ["NY", "New York"],
  ["WA", "Washington"],
  ["Other", "Other"],
];

const FILING_OPTIONS: [FilingStatus, string][] = [
  ["Single", "Single"],
  ["MarriedFilingJointly", "Married Filing Jointly"],
  ["MarriedFilingSeparately", "Married Filing Separately"],
  ["HeadOfHousehold", "Head of Household"],
];

export function PagePlan() {
  const { plan, updatePlan } = usePlan();
  const updateProfile = (profile: Parameters<typeof updatePlan>[0]["profile"]) =>
    updatePlan({ profile });
  const p = plan.profile;

  const tax = useMemo(() => {
    try {
      return calculateTax(
        p.currentSalary,
        0,
        p.age,
        p.filingStatus,
        p.state,
        p.desiredSpending,
      );
    } catch {
      return null;
    }
  }, [p.currentSalary, p.age, p.filingStatus, p.state, p.desiredSpending]);

  const totalTax = tax?.totalTax ?? 0;
  const effRate = tax?.effectiveRate ?? 0;
  const takeHome = p.currentSalary - totalTax;
  const available = takeHome - p.desiredSpending;
  const availableRate = p.currentSalary > 0 ? available / p.currentSalary : 0;
  const spendOfGross = p.currentSalary > 0 ? p.desiredSpending / p.currentSalary : 0;
  const takeHomeRate = p.currentSalary > 0 ? takeHome / p.currentSalary : 0;

  return (
    <PageShell>
      <PageHeader
        title="Profile"
        description="Facts about you. Auto-saves on change."
      />

      <DashboardCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Current age"
            value={p.age}
            onChange={(v) => updateProfile({ age: v })}
          />
          <NumberField
            label="Life expectancy"
            value={p.lifeExpectancy}
            onChange={(v) => updateProfile({ lifeExpectancy: v })}
          />
          <DateField
            label="As-of date"
            value={p.asOfDate}
            onChange={(v) => updateProfile({ asOfDate: v })}
          />
          <SelectField
            label="State"
            value={p.state}
            options={STATE_OPTIONS}
            onChange={(v) => updateProfile({ state: v as State })}
          />
          <SelectField
            label="Filing status"
            value={p.filingStatus}
            options={FILING_OPTIONS}
            onChange={(v) => updateProfile({ filingStatus: v as FilingStatus })}
          />
          <CurrencyField
            label="Current salary"
            value={p.currentSalary}
            onChange={(v) => updateProfile({ currentSalary: v })}
          />
          <CurrencyField
            label="Desired retirement spending (annual)"
            value={p.desiredSpending}
            onChange={(v) => updateProfile({ desiredSpending: v })}
          />
          <NumberField
            label="Salary growth (real %)"
            value={Number((p.salaryGrowthRate * 100).toFixed(1))}
            step={0.1}
            onChange={(v) => updateProfile({ salaryGrowthRate: v / 100 })}
          />
        </div>
      </DashboardCard>

      <DashboardCard title="Tax & Savings" flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flow</TableHead>
              <TableHead className="text-right">Annual</TableHead>
              <TableHead className="text-right">% of Gross</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <FlowRow label="Gross salary" amount={fmtCurrency(p.currentSalary)} pct="100%" strong />
            <FlowRow
              label="− Estimated taxes (federal + state + FICA)"
              amount={`-${fmtCurrency(totalTax)}`}
              pct={fmtPercent(effRate, 1)}
              tone="negative"
              indent
            />
            <FlowRow
              label="Take-home pay"
              amount={fmtCurrency(takeHome)}
              pct={fmtPercent(takeHomeRate, 1)}
              strong
            />
            <FlowRow
              label="− Annual spending"
              amount={`-${fmtCurrency(p.desiredSpending)}`}
              pct={fmtPercent(spendOfGross, 1)}
              tone="negative"
              indent
            />
            <FlowRow
              label="Available for savings"
              amount={fmtCurrency(available)}
              pct={fmtPercent(availableRate, 1)}
              strong
            />
          </TableBody>
        </Table>
        <div className="bg-muted/40 border-border text-muted-foreground border-t px-4 py-2.5 text-[11px]">
          {p.state === "CA" ? "Federal + California 2025" : "Federal 2025"} brackets and FICA.
        </div>
      </DashboardCard>
    </PageShell>
  );
}

// -- Field primitives --------------------------------------------------------

function Wrap({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <Wrap label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
    </Wrap>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <Wrap label={label} htmlFor={id}>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </Wrap>
  );
}

function CurrencyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const formatted = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value || 0),
    [value],
  );
  // Switch to raw editing on focus, format on blur — keeps text caret happy.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Wrap label={label} htmlFor={id}>
      <Input
        id={id}
        inputMode="numeric"
        className="font-mono"
        value={draft ?? formatted}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft == null) return;
          const n = Number(draft.replace(/[^0-9.-]/g, ""));
          if (!Number.isNaN(n)) onChange(n);
          setDraft(null);
        }}
      />
    </Wrap>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <Wrap label={label} htmlFor={id}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Wrap>
  );
}

function FlowRow({
  label,
  amount,
  pct,
  tone,
  strong,
  indent,
}: {
  label: string;
  amount: string;
  pct: string;
  tone?: "negative";
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <TableRow className={cn(strong && "bg-muted/40")}>
      <TableCell
        className={cn(
          tone === "negative" && "text-danger",
          strong && "font-semibold",
          indent && "pl-8",
        )}
      >
        {label}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono",
          tone === "negative" && "text-danger",
          strong && "font-semibold",
        )}
      >
        {amount}
      </TableCell>
      <TableCell className="text-muted-foreground text-right font-mono">{pct}</TableCell>
    </TableRow>
  );
}
