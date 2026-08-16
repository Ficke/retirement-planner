"use client";

import { useId, useMemo, useState } from "react";

import { usePlan } from "@/state/usePlan";
import { ageOn } from "@/domain/age";
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
import { fmtCurrency, fmtPercent, fmtSigned } from "../format";
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
  const { hsaEligible, useBackdoorRoth } = plan.assumptions;
  const age = ageOn(p.birthDate, p.asOfDate);

  const workingCashFlow = useMemo(() => {
    try {
      return calculateWorkingCashFlow(
        p.currentSalary,
        p.currentSpending,
        age,
        p.filingStatus,
        p.state,
        { hsaEligible, useBackdoorRoth },
      );
    } catch {
      return null;
    }
  }, [p.currentSalary, p.currentSpending, age, p.filingStatus, p.state, hsaEligible, useBackdoorRoth]);

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
  const totalSaved = workingCashFlow?.totalContributions ?? 0;
  const fundingGap = workingCashFlow?.fundingGap ?? 0;
  const savedRate = p.currentSalary > 0 ? totalSaved / p.currentSalary : 0;
  const spendOfGross = p.currentSalary > 0 ? p.currentSpending / p.currentSalary : 0;
  const takeHomeRate = p.currentSalary > 0 ? takeHome / p.currentSalary : 0;
  const workingYears = Math.max(0, p.retirementAge - age);
  const finalWorkingSpending = workingYears > 0
    ? p.currentSpending * (1 + p.workingSpendingGrowthRate) ** Math.max(0, workingYears - 1)
    : null;
  const retirementTransition = finalWorkingSpending == null
    ? null
    : p.retirementSpending - finalWorkingSpending;
  const retirementTransitionRate = finalWorkingSpending && retirementTransition != null
    ? retirementTransition / finalWorkingSpending
    : null;

  return (
    <PageShell>
      <PageHeader
        title="Profile"
        description="Personal details and planning assumptions. Auto-saves on change."
      />

      <DashboardCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <DateField
            label={`Date of birth · age ${age}`}
            value={p.birthDate}
            onChange={(v) => updateProfile({ birthDate: v })}
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
          <NumberField
            label="Salary growth (real %)"
            value={Number((p.salaryGrowthRate * 100).toFixed(1))}
            step={0.1}
            min={-10}
            max={20}
            onChange={(v) => updateProfile({ salaryGrowthRate: v / 100 })}
          />
        </div>
      </DashboardCard>

      <DashboardCard
        title="Spending plan"
        description="Set working and retirement spending together. Amounts are annual and shown in today's dollars; growth rates are real changes above or below inflation."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="border-border rounded-lg border p-4">
            <div className="mb-4">
              <h3 className="font-medium">Working years</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Current spending is the annual rate at the as-of date. Growth applies once per
                subsequent working year.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <CurrencyField
                label="Current annual spending"
                value={p.currentSpending}
                onChange={(v) => updateProfile({ currentSpending: v })}
              />
              <NumberField
                label="Annual real growth (%)"
                value={Number((p.workingSpendingGrowthRate * 100).toFixed(1))}
                step={0.1}
                min={-10}
                max={10}
                onChange={(v) => updateProfile({ workingSpendingGrowthRate: v / 100 })}
              />
            </div>
          </div>

          <div className="border-border rounded-lg border p-4">
            <div className="mb-4">
              <h3 className="font-medium">Retirement</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                The target is independent of working-year spending. Growth applies after the first
                modeled year of retirement.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <CurrencyField
                label="First-year annual target"
                value={p.retirementSpending}
                onChange={(v) => updateProfile({ retirementSpending: v })}
              />
              <NumberField
                label="Annual real growth (%)"
                value={Number((p.retirementSpendingGrowthRate * 100).toFixed(1))}
                step={0.1}
                min={-10}
                max={10}
                onChange={(v) => updateProfile({ retirementSpendingGrowthRate: v / 100 })}
              />
            </div>
          </div>
        </div>

        <div className="bg-muted/40 border-border mt-4 rounded-lg border p-4">
          {finalWorkingSpending == null ? (
            <div>
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Retirement spending now
              </div>
              <div className="mt-1 font-mono text-lg font-semibold">
                {fmtCurrency(p.retirementSpending)}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                This plan is already retired, so the target starts in the as-of year with no
                elapsed-retirement growth applied.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SpendingPreview
                label={`Current · age ${age}`}
                value={p.currentSpending}
              />
              <SpendingPreview
                label={`Final working year · age ${p.retirementAge - 1}`}
                value={finalWorkingSpending}
              />
              <SpendingPreview
                label={`First retirement year · age ${p.retirementAge}`}
                value={p.retirementSpending}
                detail={retirementTransition == null
                  ? undefined
                  : `${fmtSigned(retirementTransition)}${retirementTransitionRate == null
                    ? ""
                    : ` (${fmtPercent(retirementTransitionRate, 1)})`} transition`}
              />
            </div>
          )}
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
        title="Cash flow"
        description="Savings is what's left after taxes and spending, filled into HSA, 401(k), and Roth up to their IRS limits before the remainder goes to a taxable brokerage."
        flush
      >
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
              label="→ Roth + Taxable contributions"
              amount={fmtCurrency(actualContributions.roth + actualContributions.taxable)}
              pct={fmtPercent(
                p.currentSalary > 0
                  ? (actualContributions.roth + actualContributions.taxable) / p.currentSalary
                  : 0,
                1,
              )}
              indent
            />
            <FlowRow
              label={fundingGap > 0 ? "Drawn from portfolio" : "Total saved"}
              amount={fundingGap > 0 ? `-${fmtCurrency(fundingGap)}` : fmtCurrency(totalSaved)}
              pct={fmtPercent(
                fundingGap > 0 && p.currentSalary > 0 ? -fundingGap / p.currentSalary : savedRate,
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

function SpendingPreview({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold">{fmtCurrency(value)}</div>
      {detail && <div className="text-muted-foreground mt-1 text-xs">{detail}</div>}
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <Wrap label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
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
