import { useId, useMemo, useState } from "react";

import { usePlan } from "@/state/usePlan";
import { ageOn, retirementSpendingOf } from "@/domain/age";
import { estimatedFirstRetirementYearMagi, healthcareCostFor } from "@/domain/healthcare";
import type { FilingStatus, State } from "@/domain/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
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
  const ltc = p.longTermCare;
  const updateLongTermCare = (patch: Partial<typeof ltc>) =>
    updateProfile({ longTermCare: { ...ltc, ...patch } });
  const age = ageOn(p.birthDate, p.asOfDate);
  const retirementSpending = retirementSpendingOf(p);
  // An already-retired plan's first modeled year is the as-of year, so it is
  // priced at today's age rather than at the retirement age it passed already.
  const firstRetirementAge = Math.max(age, p.retirementAge);
  const yearsToRetirement = Math.max(0, p.retirementAge - age);
  // The engine prices the first retirement year on an estimate of that year's
  // own income rather than on the salary that stopped, so the preview does too
  // — otherwise it promises a premium the projection will not charge.
  const firstYearGrowth = (1 + p.retirementHealthcare.realGrowthRate) ** yearsToRetirement;
  const firstYearHealthcare = healthcareCostFor(
    p.retirementHealthcare,
    firstRetirementAge,
    yearsToRetirement,
    {
      priorYearMagi: estimatedFirstRetirementYearMagi(
        retirementSpending + p.retirementHealthcare.outOfPocket * firstYearGrowth,
        0,
        plan.accounts,
        plan.assumptions.taxableGainRatio,
        plan.assumptions.magiAwareWithdrawals,
      ),
      filingStatus: p.filingStatus,
      householdSize: 1,
    },
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
        description="Today's dollars, whole household. Added to your spending target."
      >
        <div className="grid max-w-xl grid-cols-2 items-end gap-x-4 gap-y-4 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-y-2.5">
          <div className="hidden sm:block" />
          <PhaseHeader label="Before 65" detail="Marketplace or COBRA" />
          <PhaseHeader label="From 65" detail="Medicare" />

          <RowLabel>Premiums</RowLabel>
          <div className="col-span-2 sm:col-span-1">
            <CurrencyField
              label="Premiums before 65"
              labelClassName="sm:sr-only"
              value={h.preMedicarePremium}
              onChange={(v) => updateHealthcare({ preMedicarePremium: v })}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <CurrencyField
              label="Premiums from 65"
              labelClassName="sm:sr-only"
              value={h.medicarePremium}
              onChange={(v) => updateHealthcare({ medicarePremium: v })}
            />
          </div>

          <RowLabel>Out-of-pocket</RowLabel>
          <div className="col-span-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="w-full max-w-36">
              <CurrencyField
                label="Out-of-pocket"
                labelClassName="sm:sr-only"
                value={h.outOfPocket}
                onChange={(v) => updateHealthcare({ outOfPocket: v })}
              />
            </div>
            <span className="text-muted-foreground pb-2.5 text-xs">Both phases</span>
          </div>

          <div className="border-border col-span-2 border-t sm:col-span-3 sm:mt-1" />

          <RowLabel>Per year</RowLabel>
          <div>
            <div className="text-muted-foreground text-xs sm:hidden">Before 65</div>
            <PhaseTotal value={h.preMedicarePremium + h.outOfPocket} />
          </div>
          <div>
            <div className="text-muted-foreground text-xs sm:hidden">From 65</div>
            <PhaseTotal value={h.medicarePremium + h.outOfPocket} />
          </div>

          <RowLabel>Growth</RowLabel>
          <div className="col-span-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="w-full max-w-32">
              <NumberField
                label="Growth above inflation (%)"
                labelClassName="sm:sr-only"
                value={Number((h.realGrowthRate * 100).toFixed(1))}
                step={0.1}
                min={-10}
                max={10}
                onChange={(v) => updateHealthcare({ realGrowthRate: v / 100 })}
              />
            </div>
            <span className="text-muted-foreground hidden pb-2.5 text-xs sm:inline">
              % a year above inflation
            </span>
          </div>
        </div>

        <div className="border-border mt-6 border-t pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Long-term care</div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                A possible care episode, drawn per scenario from national spending data.
              </p>
            </div>
            <Switch
              checked={ltc.enabled}
              onCheckedChange={(enabled) => updateLongTermCare({ enabled })}
              aria-label="Model a long-term care episode"
            />
          </div>

          {ltc.enabled && (
            <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
              <div className="w-full max-w-32">
                <NumberField
                  label="Cost level"
                  value={ltc.costMultiplier}
                  step={0.05}
                  min={0.5}
                  max={3}
                  onChange={(v) => updateLongTermCare({ costMultiplier: v })}
                />
              </div>
              <span className="text-muted-foreground pb-2.5 text-xs">
                National average · California ≈ 1.2
              </span>
            </div>
          )}
        </div>

        <p className="text-muted-foreground border-border mt-5 border-t pt-3 text-xs">
          An HSA covers out-of-pocket, Medicare, COBRA, and long-term care — not
          marketplace premiums.
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
  labelClassName,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  labelClassName?: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={htmlFor}
        className={cn(
          "text-muted-foreground text-xs font-medium tracking-wide uppercase",
          labelClassName,
        )}
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

function RowLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground hidden text-sm sm:block sm:pb-2">{children}</div>;
}

function PhaseHeader({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="hidden self-start sm:block">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-muted-foreground text-xs">{detail}</div>
    </div>
  );
}

function PhaseTotal({ value }: { value: number }) {
  return <div className="font-mono text-lg font-semibold">{fmtCurrency(value)}</div>;
}

/**
 * A number input. Pass `label` for a standalone field, or `ariaLabel` when a
 * surrounding row and column already name it on screen.
 *
 * A value outside `min`/`max` is held in the input but not committed, because
 * `updatePlan` re-validates the whole plan and would reject the edit outright.
 * Blurring commits the clamped value.
 */
function NumberField({
  label,
  labelClassName,
  ariaLabel,
  value,
  step,
  min = -Infinity,
  max = Infinity,
  hint,
  onChange,
}: {
  label?: string;
  labelClassName?: string;
  ariaLabel?: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const input = (
    <Input
      id={id}
      type="number"
      aria-label={ariaLabel}
      step={step}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && !Number.isNaN(n) && n >= min && n <= max) {
          onChange(n);
        }
      }}
      onBlur={() => {
        if (draft == null) return;
        const n = Number(draft);
        if (draft.trim() !== "" && !Number.isNaN(n)) {
          onChange(Math.min(max, Math.max(min, n)));
        }
        setDraft(null);
      }}
    />
  );
  if (!label) return input;
  return (
    <Wrap label={label} labelClassName={labelClassName} htmlFor={id} hint={hint}>
      {input}
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

/** A dollar input. Labelled like {@link NumberField}. */
function CurrencyField({
  label,
  labelClassName,
  ariaLabel,
  hint,
  value,
  onChange,
}: {
  label?: string;
  labelClassName?: string;
  ariaLabel?: string;
  hint?: string;
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
  const input = (
    <Input
      id={id}
      inputMode="numeric"
      aria-label={ariaLabel}
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
  );
  if (!label) return input;
  return (
    <Wrap label={label} labelClassName={labelClassName} htmlFor={id} hint={hint}>
      {input}
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
