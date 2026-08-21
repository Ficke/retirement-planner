"use client";

import { useId, useMemo, useState } from "react";

import { usePlan } from "@/state/usePlan";
import { ageOn, retirementSpendingOf } from "@/domain/age";
import { healthcareCostFor } from "@/domain/healthcare";
import type { FilingStatus, State } from "@/domain/types";
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
  DashboardCard,
  PageHeader,
  PageShell,
} from "@/components/retire/ui";
import { fmtCurrency, fmtPercent, fmtSigned } from "../format";

const STATE_OPTIONS: [State, string][] = [
  ["CA", "California"],
  ["TX", "Texas"],
  ["FL", "Florida"],
  ["NY", "New York"],
  ["WA", "Washington"],
  ["Other", "Other"],
];

/** How the model treats each state, shown once under the field. */
const STATE_TAX_NOTE: Record<State, string> = {
  CA: "State income tax modeled",
  TX: "No state income tax",
  FL: "No state income tax",
  NY: "State and local tax excluded",
  WA: "Capital-gains tax excluded",
  Other: "State and local tax excluded",
};

const FILING_OPTIONS: [FilingStatus, string][] = [
  ["Single", "Single"],
  ["MarriedFilingJointly", "Married Filing Jointly"],
  ["MarriedFilingSeparately", "Married Filing Separately"],
  ["HeadOfHousehold", "Head of Household"],
];

export function PageProfile() {
  const { plan, updatePlan } = usePlan();
  const updateProfile = (profile: Parameters<typeof updatePlan>[0]["profile"]) =>
    updatePlan({ profile });
  const updateSocialSecurity = (
    socialSecurity: Parameters<typeof updatePlan>[0]["socialSecurity"],
  ) => updatePlan({ socialSecurity });
  const p = plan.profile;
  const ss = plan.socialSecurity;
  const h = p.retirementHealthcare;
  const updateHealthcare = (patch: Partial<typeof h>) =>
    updateProfile({ retirementHealthcare: { ...h, ...patch } });
  const age = ageOn(p.birthDate, p.asOfDate);
  const retirementSpending = retirementSpendingOf(p);
  // An already-retired plan's first modeled year is the as-of year, so it is
  // priced at today's age rather than at the retirement age it passed already.
  const firstRetirementAge = Math.max(age, p.retirementAge);
  const firstYearHealthcare = healthcareCostFor(
    p.retirementHealthcare,
    firstRetirementAge,
    Math.max(0, p.retirementAge - age),
  ).total;
  // The engine funds healthcare on top of the spending target, so a preview
  // that showed the target alone would understate what the plan has to cover.
  const retirementSpendingTotal = retirementSpending + firstYearHealthcare;

  const workingYears = Math.max(0, p.retirementAge - age);
  const finalWorkingSpending = workingYears > 0
    ? p.currentSpending * (1 + p.workingSpendingGrowthRate) ** Math.max(0, workingYears - 1)
    : null;
  const retirementTransition = finalWorkingSpending == null
    ? null
    : retirementSpendingTotal - finalWorkingSpending;
  const retirementTransitionRate = finalWorkingSpending && retirementTransition != null
    ? retirementTransition / finalWorkingSpending
    : null;

  return (
    <PageShell>
      <PageHeader
        title="Profile"
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
            hint={STATE_TAX_NOTE[p.state]}
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
            label="Salary growth above inflation (%)"
            value={Number((p.salaryGrowthRate * 100).toFixed(1))}
            step={0.1}
            min={-10}
            max={20}
            onChange={(v) => updateProfile({ salaryGrowthRate: v / 100 })}
          />
        </div>
      </DashboardCard>

      <DashboardCard title="Spending">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SubCard title="Spending growth while working">
            <NumberField
              label="Growth above inflation (%)"
              value={Number((p.workingSpendingGrowthRate * 100).toFixed(1))}
              step={0.1}
              min={-10}
              max={10}
              hint="The amount itself is on the Plan page."
              onChange={(v) => updateProfile({ workingSpendingGrowthRate: v / 100 })}
            />
          </SubCard>

          <SubCard title="Retirement spending">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                label="Share of final working spending (%)"
                value={Number((p.retirementSpendingMultiplier * 100).toFixed(0))}
                step={1}
                min={0}
                max={300}
                onChange={(v) => updateProfile({ retirementSpendingMultiplier: v / 100 })}
              />
              <NumberField
                label="Growth above inflation (%)"
                value={Number((p.retirementSpendingGrowthRate * 100).toFixed(1))}
                step={0.1}
                min={-10}
                max={10}
                onChange={(v) => updateProfile({ retirementSpendingGrowthRate: v / 100 })}
              />
            </div>
          </SubCard>
        </div>

        <div className="bg-muted/40 border-border mt-4 rounded-lg border p-4">
          {finalWorkingSpending == null ? (
            <div>
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Retirement spending now
              </div>
              <div className="mt-1 font-mono text-lg font-semibold">
                {fmtCurrency(retirementSpendingTotal)}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                Already retired, so the target starts in the as-of year.
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
                value={retirementSpendingTotal}
                detail={retirementTransition == null
                  ? undefined
                  : `${fmtSigned(retirementTransition)}${retirementTransitionRate == null
                    ? ""
                    : ` (${fmtPercent(retirementTransitionRate, 1)})`} transition`}
              />
            </div>
          )}
          {firstYearHealthcare > 0 && (
            <p className="text-muted-foreground mt-3 text-xs">
              Includes {fmtCurrency(firstYearHealthcare)} of healthcare, set below.
            </p>
          )}
        </div>
      </DashboardCard>

      <DashboardCard
        title="Retirement healthcare"
        description="Today's cost for the whole household, added on top of the spending target."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CurrencyField
            label="Premiums before 65"
            value={h.preMedicarePremium}
            onChange={(v) => updateHealthcare({ preMedicarePremium: v })}
          />
          <CurrencyField
            label="Premiums from 65"
            value={h.medicarePremium}
            onChange={(v) => updateHealthcare({ medicarePremium: v })}
          />
          <CurrencyField
            label="Out-of-pocket"
            value={h.outOfPocket}
            onChange={(v) => updateHealthcare({ outOfPocket: v })}
          />
          <NumberField
            label="Growth above inflation (%)"
            value={Number((h.realGrowthRate * 100).toFixed(1))}
            step={0.1}
            min={-10}
            max={10}
            onChange={(v) => updateHealthcare({ realGrowthRate: v / 100 })}
          />
        </div>
        <div className="bg-muted/40 border-border mt-4 grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <SpendingPreview
            label="Before 65"
            value={h.preMedicarePremium + h.outOfPocket}
            detail="Marketplace or COBRA coverage"
          />
          <SpendingPreview
            label="From 65"
            value={h.medicarePremium + h.outOfPocket}
            detail="Part B, Part D, and supplemental"
          />
        </div>
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          An HSA can pay out-of-pocket costs tax-free, and premiums once you are on Medicare.
          It cannot pay marketplace premiums. The only premiums it covers are COBRA,
          unemployment, Medicare, and long-term care.
        </p>
      </DashboardCard>


      <DashboardCard title="Social Security">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SelectField
            label="Include benefits"
            value={ss.enabled ? "on" : "off"}
            options={[["on", "Included"], ["off", "Excluded"]]}
            onChange={(value) => updateSocialSecurity({ enabled: value === "on" })}
          />
          <SelectField
            label="Benefit source"
            value={ss.manualOverride ? "statement" : "estimate"}
            options={[["statement", "SSA statement"], ["estimate", "Salary-based estimate"]]}
            hint={ss.manualOverride
              ? undefined
              : "Estimated from one earner's salary. Not an SSA quote."}
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

    </PageShell>
  );
}

function Wrap({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
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
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/**
 * A titled block inside a card. Named as a group for the same reason the cards
 * are: both growth fields here read "Growth above inflation" and only the
 * heading says which is which.
 */
function SubCard({ title, children }: { title: string; children: React.ReactNode }) {
  const titleId = useId();
  return (
    <div className="border-border rounded-lg border p-4" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="mb-4 font-medium">{title}</h3>
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
  hint,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <Wrap label={label} htmlFor={id} hint={hint}>
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
  hint,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  hint?: string;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <Wrap label={label} htmlFor={id} hint={hint}>
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
