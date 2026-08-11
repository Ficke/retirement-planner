"use client";

import { useId, useMemo, useState } from "react";

import { usePlan } from "@/state/usePlan";
import type { FilingStatus, State } from "@/domain/types";
import { calculateWorkingCashFlow } from "@/engine/tax";
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
  ["CA", "California — 2025 tax estimate"],
  ["TX", "Texas — no individual income tax"],
  ["FL", "Florida — no individual income tax"],
  ["NY", "New York — state/local tax excluded"],
  ["WA", "Washington — capital-gains tax excluded"],
  ["Other", "Other — state/local tax excluded"],
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
  const updateSocialSecurity = (
    socialSecurity: Parameters<typeof updatePlan>[0]["socialSecurity"],
  ) => updatePlan({ socialSecurity });
  const p = plan.profile;
  const ss = plan.socialSecurity;
  const contributionTargets = plan.assumptions.contributions;
  const updateContribution = (field: keyof typeof contributionTargets, value: number) =>
    updatePlan({
      assumptions: {
        contributions: { ...contributionTargets, [field]: value },
      },
    });

  const workingCashFlow = useMemo(() => {
    try {
      return calculateWorkingCashFlow(
        p.currentSalary,
        p.currentSpending,
        p.age,
        p.filingStatus,
        p.state,
        {
          hsa: plan.accounts.some((account) => account.type === "HSA") ? contributionTargets.hsa : 0,
          traditional: plan.accounts.some((account) => account.type === "Traditional")
            ? contributionTargets.traditional
            : 0,
          roth: plan.accounts.some((account) => account.type === "Roth") ? contributionTargets.roth : 0,
          taxable: plan.accounts.some((account) => account.type === "Taxable")
            ? contributionTargets.taxable
            : 0,
        },
      );
    } catch {
      return null;
    }
  }, [p.currentSalary, p.currentSpending, p.age, p.filingStatus, p.state, plan.accounts, contributionTargets]);

  const tax = workingCashFlow?.tax;
  const actualContributions = workingCashFlow?.contributions ?? {
    hsa: 0,
    traditional: 0,
    roth: 0,
    taxable: 0,
  };
  const totalTax = tax?.totalTax ?? 0;
  const effRate = tax?.effectiveRate ?? 0;
  const takeHome = p.currentSalary - totalTax - actualContributions.hsa - actualContributions.traditional;
  const available = workingCashFlow?.unallocatedCash ?? 0;
  const fundingGap = workingCashFlow?.fundingGap ?? 0;
  const availableRate = p.currentSalary > 0 ? available / p.currentSalary : 0;
  const spendOfGross = p.currentSalary > 0 ? p.currentSpending / p.currentSalary : 0;
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
            label="Primary age"
            value={p.age}
            onChange={(v) => updateProfile({
              age: v,
              birthYear: Number(p.asOfDate.slice(0, 4)) - v,
            })}
          />
          <NumberField
            label="Birth year (for RMD cohort)"
            value={p.birthYear ?? Number(p.asOfDate.slice(0, 4)) - p.age}
            onChange={(v) => updateProfile({ birthYear: v })}
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
            label="Primary annual wages"
            value={p.currentSalary}
            onChange={(v) => updateProfile({ currentSalary: v })}
          />
          <CurrencyField
            label="Current spending (annual, real)"
            value={p.currentSpending}
            onChange={(v) => updateProfile({ currentSpending: v })}
          />
          <CurrencyField
            label="Retirement spending target (annual, real)"
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

      {(p.state === "NY" || p.state === "WA" || p.state === "Other") && (
        <div className="border-warning/40 bg-warning/10 text-foreground rounded-lg border px-4 py-3 text-sm">
          State and local taxes are excluded for this selection, so projected spendable income and
          success can be overstated. Federal tax remains modeled using 2025 law in real dollars.
        </div>
      )}

      <DashboardCard
        title="Social Security"
        description="Use a combined annual household benefit at the selected claim age when available. The salary-based option estimates only the primary person from primary wages using the 2025 PIA formula, without wage-indexing past earnings; it is not an official SSA quote."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SelectField
            label="Include benefits"
            value={ss.enabled ? "on" : "off"}
            options={[["on", "Included"], ["off", "Excluded"]]}
            onChange={(value) => updateSocialSecurity({ enabled: value === "on" })}
          />
          <NumberField
            label="Claim age"
            value={ss.claimAge}
            onChange={(value) => updateSocialSecurity({ claimAge: value })}
          />
          <SelectField
            label="Benefit source"
            value={ss.manualOverride ? "statement" : "estimate"}
            options={[["statement", "SSA statement"], ["estimate", "Salary-based estimate"]]}
            onChange={(value) => updateSocialSecurity({ manualOverride: value === "statement" })}
          />
          {ss.manualOverride && (
            <CurrencyField
              label="Annual household benefit at claim age"
              value={ss.estimatedBenefit ?? 0}
              onChange={(value) => updateSocialSecurity({ estimatedBenefit: value })}
            />
          )}
        </div>
      </DashboardCard>

      <DashboardCard
        title="Annual contribution targets"
        description="Targets are applied only to matching accounts and reduced when IRS limits or available cash require it. Priority: HSA, Traditional, Roth, then Taxable."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <CurrencyField
            label="HSA (individual coverage)"
            value={contributionTargets.hsa}
            onChange={(v) => updateContribution("hsa", v)}
          />
          <CurrencyField
            label="Traditional 401(k)"
            value={contributionTargets.traditional}
            onChange={(v) => updateContribution("traditional", v)}
          />
          <CurrencyField
            label="Roth IRA"
            value={contributionTargets.roth}
            onChange={(v) => updateContribution("roth", v)}
          />
          <CurrencyField
            label="Taxable brokerage"
            value={contributionTargets.taxable}
            onChange={(v) => updateContribution("taxable", v)}
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
              label="− HSA + Traditional contributions"
              amount={`-${fmtCurrency(actualContributions.hsa + actualContributions.traditional)}`}
              pct={fmtPercent(
                p.currentSalary > 0
                  ? (actualContributions.hsa + actualContributions.traditional) / p.currentSalary
                  : 0,
                1,
              )}
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
              amount={`-${fmtCurrency(p.currentSpending)}`}
              pct={fmtPercent(spendOfGross, 1)}
              tone="negative"
              indent
            />
            <FlowRow
              label="− Roth + Taxable contributions"
              amount={`-${fmtCurrency(actualContributions.roth + actualContributions.taxable)}`}
              pct={fmtPercent(
                p.currentSalary > 0
                  ? (actualContributions.roth + actualContributions.taxable) / p.currentSalary
                  : 0,
                1,
              )}
              tone="negative"
              indent
            />
            <FlowRow
              label={fundingGap > 0 ? "Annual cash shortfall" : "Unallocated cash"}
              amount={fundingGap > 0 ? `-${fmtCurrency(fundingGap)}` : fmtCurrency(available)}
              pct={fmtPercent(
                fundingGap > 0 && p.currentSalary > 0 ? -fundingGap / p.currentSalary : availableRate,
                1,
              )}
              tone={fundingGap > 0 ? "negative" : undefined}
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
