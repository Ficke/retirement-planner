"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { usePlan } from "@/state/usePlan";
import { MIN_RETIREMENT_AGE } from "@/domain/constants";
import type { SimulationResult } from "@/domain/types";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DashboardCard,
  KPIGrid,
  PageHeader,
  PageShell,
  Stat,
} from "@/components/retire/ui";
import { Donut, SensitivityChart, WealthFanChart } from "@/components/ui/charts";
import { fmtCurrency, fmtPercent, successTone } from "../format";
import { cn } from "@/lib/utils";

const KIND_COLOR: Record<string, { label: string; color: string }> = {
  Taxable: { label: "Taxable", color: "var(--color-account-taxable)" },
  Traditional: { label: "Traditional", color: "var(--color-account-traditional)" },
  Roth: { label: "Roth", color: "var(--color-account-roth)" },
  HSA: { label: "HSA", color: "var(--color-account-hsa)" },
};

type Point = { x: number; y: number };

function toPoints<T>(arr: T[] | null | undefined, xKey: keyof T): Point[] {
  if (!arr) return [];
  return arr
    .map((item) => ({
      x: item[xKey] as unknown as number,
      y: (item as unknown as { result: SimulationResult }).result.successProbability,
    }))
    .sort((a, b) => a.x - b.x);
}

/**
 * A plan lever: slider to change it, sensitivity curve showing how success
 * probability responds across the lever's range (marker = current value).
 */
function LeverCard({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  points,
  xFormat,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  points: Point[];
  xFormat: (v: number) => string;
}) {
  const inRange =
    points.length > 0 && value >= points[0].x && value <= points[points.length - 1].x;

  let markerY: number | null = null;
  if (inRange) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (value >= a.x && value <= b.x) {
        const t = (value - a.x) / (b.x - a.x || 1);
        markerY = a.y + t * (b.y - a.y);
        break;
      }
    }
    if (markerY == null) markerY = points[points.length - 1].y;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Label className="text-foreground text-sm font-medium">{label}</Label>
        <span className="text-foreground font-mono text-sm font-semibold tabular-nums">
          {display}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
      {points.length === 0 ? (
        <Skeleton className="h-[120px] w-full" />
      ) : (
        <div className="flex flex-col gap-1">
          <SensitivityChart
            points={points}
            marker={inRange && markerY != null ? { x: value, y: markerY } : undefined}
            xLabel={label}
            xFormat={xFormat}
            height={120}
          />
          <div className="text-muted-foreground text-right font-mono text-[11px]">
            {inRange && markerY != null
              ? `${fmtPercent(markerY, 0)} success at ${xFormat(value)}`
              : "outside swept range"}
          </div>
        </div>
      )}
    </div>
  );
}

export function PageOverview() {
  const plan = usePlan((s) => s.plan);
  const liveResult = usePlan((s) => s.simulationResult);
  const isSimulating = usePlan((s) => s.isSimulatingMain);
  const updatePlan = usePlan((s) => s.updatePlan);
  const accounts = usePlan((s) => s.plan.accounts);
  const ssAnalysisResult = usePlan((s) => s.ssAnalysisResult);
  const spendingAnalysisResult = usePlan((s) => s.spendingAnalysisResult);
  const retirementAgeAnalysisResult = usePlan((s) => s.retirementAgeAnalysisResult);

  // Keep the last completed result visible while a new simulation runs,
  // so slider drags don't flash "0% / Off track" between recomputes.
  const lastResultRef = useRef<SimulationResult | null>(null);
  useEffect(() => {
    if (liveResult) lastResultRef.current = liveResult;
  }, [liveResult]);
  const result = liveResult ?? lastResultRef.current;
  const isUpdating = isSimulating || !liveResult;
  const hasEverComputed = result !== null;

  const netWorth = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const yearsToRetire = Math.max(0, plan.profile.retirementAge - plan.profile.age);
  const retirementYear = new Date().getFullYear() + yearsToRetire;
  const successProb = result?.successProbability ?? 0;
  const { label: successLabel, tone: successToneValue } = successTone(successProb);

  const byKind: Record<string, number> = {};
  for (const a of accounts) {
    byKind[a.type] = (byKind[a.type] || 0) + (a.balance || 0);
  }
  const allocData = Object.entries(byKind).map(([k, v]) => ({
    label: KIND_COLOR[k]?.label ?? k,
    value: v,
    color: KIND_COLOR[k]?.color ?? "var(--color-muted-foreground)",
  }));

  const monthlySpend = plan.profile.desiredSpending / 12;
  const spendOfSalary =
    plan.profile.currentSalary > 0
      ? plan.profile.desiredSpending / plan.profile.currentSalary
      : 0;

  const agePts = toPoints(retirementAgeAnalysisResult, "retirementAge");
  const spendPts = toPoints(spendingAnalysisResult, "annualSpending");
  const ssPts = toPoints(ssAnalysisResult, "claimAge");

  return (
    <PageShell>
      <PageHeader title="Overview" />

      <KPIGrid cols={4}>
        <Stat
          label="Plan Health"
          value={
            isUpdating ? (
              <span className="text-muted-foreground inline-flex h-8 items-center">
                <Loader2 className="size-6 animate-spin" />
              </span>
            ) : hasEverComputed ? (
              `${(successProb * 100).toFixed(0)}%`
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
          trend={
            isUpdating ? (
              <span className="text-muted-foreground inline-flex items-center gap-1.5">
                <span className="bg-muted-foreground inline-block size-1.5 animate-pulse rounded-full" />
                Updating projection…
              </span>
            ) : (
              `${successLabel} · simulated paths fund full retirement`
            )
          }
          tone={isUpdating ? "neutral" : successToneValue}
        />
        <Stat label="Net Worth" value={fmtCurrency(netWorth, true)} />
        <Stat
          label="Retirement Date"
          value={String(retirementYear)}
          trend={`Age ${plan.profile.retirementAge} · ${yearsToRetire} years away`}
        />
        <Stat
          label="Monthly Spending"
          value={fmtCurrency(monthlySpend, false).replace(".00", "")}
          trend={`${fmtPercent(spendOfSalary, 0)} of gross salary today`}
        />
      </KPIGrid>

      <DashboardCard
        title="Levers"
        description="Drag to change your plan. Each curve shows how success probability responds across the lever's range."
      >
        <div className="grid grid-cols-1 gap-7 md:grid-cols-3">
          <LeverCard
            label="Retirement age"
            value={plan.profile.retirementAge}
            display={`Age ${plan.profile.retirementAge}`}
            min={MIN_RETIREMENT_AGE}
            max={75}
            onChange={(v) => updatePlan({ profile: { retirementAge: v } })}
            points={agePts}
            xFormat={(v) => `Age ${v}`}
          />
          <LeverCard
            label="Annual spending"
            value={plan.profile.desiredSpending}
            display={fmtCurrency(plan.profile.desiredSpending)}
            min={20000}
            max={200000}
            step={1000}
            onChange={(v) => updatePlan({ profile: { desiredSpending: v } })}
            points={spendPts}
            xFormat={(v) => fmtCurrency(v, true)}
          />
          <LeverCard
            label="Social Security claim age"
            value={plan.socialSecurity.claimAge}
            display={`Age ${plan.socialSecurity.claimAge}`}
            min={62}
            max={70}
            onChange={(v) => updatePlan({ socialSecurity: { claimAge: v } })}
            points={ssPts}
            xFormat={(v) => `Age ${v}`}
          />
        </div>
      </DashboardCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard title="Wealth Trajectory">
          {result?.yearlyProjections?.length ? (
            <div
              className={cn(
                "transition-opacity duration-200",
                isUpdating && "opacity-60",
              )}
            >
              <WealthFanChart
                projections={result.yearlyProjections}
                retirementAge={plan.profile.retirementAge}
                height={260}
              />
            </div>
          ) : (
            <div className="text-muted-foreground flex h-[260px] items-center justify-center gap-2 text-sm">
              <span className="bg-muted-foreground inline-block size-1.5 animate-pulse rounded-full" />
              Running simulation…
            </div>
          )}
        </DashboardCard>

        <DashboardCard title="Allocation by Account Type">
          <div className="flex items-center gap-5">
            <Donut
              data={allocData}
              size={132}
              thickness={18}
              centerLabel="Total"
              centerValue={fmtCurrency(netWorth, true)}
            />
            <div className="flex flex-1 flex-col gap-2">
              {allocData.length === 0 && (
                <div className="text-muted-foreground text-xs">No accounts yet.</div>
              )}
              {allocData.map((a) => (
                <div key={a.label} className="flex items-center gap-2.5 text-xs">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: a.color }}
                  />
                  <span className="flex-1">{a.label}</span>
                  <span className="text-foreground/80 font-mono">
                    {fmtCurrency(a.value, true)}
                  </span>
                  <span className="text-muted-foreground min-w-10 text-right font-mono">
                    {netWorth > 0 ? ((a.value / netWorth) * 100).toFixed(0) : "0"}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </DashboardCard>
      </div>
    </PageShell>
  );
}
