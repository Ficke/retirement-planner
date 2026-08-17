"use client";

import { useEffect, useRef } from "react";
import { usePlan } from "@/state/usePlan";
import { MIN_RETIREMENT_AGE } from "@/domain/constants";
import type { SimulationResult, SimulationSummary } from "@/domain/types";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DashboardCard,
  PageHeader,
  PageShell,
} from "@/components/retire/ui";
import { SensitivityChart } from "@/components/ui/charts";
import { CashFlowCard } from "@/components/retire/cash-flow-card";
import { ProjectionsSection } from "@/components/retire/pages/projections";
import { fmtCurrency, fmtPercent } from "../format";
import { cn } from "@/lib/utils";

type Point = { x: number; y: number };

function toPoints<T>(arr: T[] | null | undefined, xKey: keyof T): Point[] {
  if (!arr) return [];
  return arr
    .map((item) => ({
      x: item[xKey] as unknown as number,
      y: (item as unknown as { result: SimulationSummary }).result.successProbability,
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
  xDomain,
  xTicks,
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
  xDomain: [number, number];
  xTicks: number[];
  xFormat: (v: number) => string;
}) {
  const inRange = points.length > 0 && value >= xDomain[0] && value <= xDomain[1];

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
    <div className="border-border/70 flex flex-col gap-3 rounded-lg border p-4">
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
        <Skeleton className="h-[180px] w-full" />
      ) : (
        <div className="flex flex-col gap-1">
          <SensitivityChart
            points={points}
            marker={inRange && markerY != null ? { x: value, y: markerY } : undefined}
            xLabel={label}
            xDomain={xDomain}
            xTicks={xTicks}
            xFormat={xFormat}
            height={156}
          />
          <div className="text-muted-foreground text-right font-mono text-[11px]">
            {inRange && markerY != null
              ? `${fmtPercent(markerY, 0)} success at ${xFormat(value)}`
              : "outside standard range"}
          </div>
        </div>
      )}
    </div>
  );
}

export function PagePlan() {
  const plan = usePlan((s) => s.plan);
  const liveResult = usePlan((s) => s.simulationResult);
  const simulationError = usePlan((s) => s.simulationError);
  const isSimulating = usePlan((s) => s.isSimulatingMain);
  const useServerSideCalculations = usePlan((s) => s.useServerSideCalculations);
  const updatePlan = usePlan((s) => s.updatePlan);
  const ssAnalysisResult = usePlan((s) => s.ssAnalysisResult);
  const spendingAnalysisResult = usePlan((s) => s.spendingAnalysisResult);
  const retirementAgeAnalysisResult = usePlan((s) => s.retirementAgeAnalysisResult);
  const isSimulatingSensitivities = usePlan((s) => s.isSimulatingSensitivities);
  const runSensitivityAnalyses = usePlan((s) => s.runSensitivityAnalyses);

  // Sensitivity sweeps are expensive and only this page displays them. Load
  // the three curves together so cloud mode uses one bounded batch request.
  useEffect(() => {
    if (
      !isSimulatingSensitivities
      && ssAnalysisResult === null
      && spendingAnalysisResult === null
      && retirementAgeAnalysisResult === null
    ) {
      const timeout = window.setTimeout(() => void runSensitivityAnalyses(), 500);
      return () => window.clearTimeout(timeout);
    }
  }, [
    plan,
    isSimulatingSensitivities,
    ssAnalysisResult,
    spendingAnalysisResult,
    retirementAgeAnalysisResult,
    runSensitivityAnalyses,
  ]);

  // Keep the last completed result visible while a new simulation runs,
  // so slider drags don't flash "0% / Off track" between recomputes.
  const lastResultRef = useRef<SimulationResult | null>(null);
  useEffect(() => {
    if (liveResult) lastResultRef.current = liveResult;
  }, [liveResult]);
  const result = liveResult ?? lastResultRef.current;
  const isUpdating = isSimulating || (!liveResult && !simulationError);
  const usedFallback = result?.source === "client" && useServerSideCalculations;
  const engineLabel = result?.source === "server"
    ? "Cloud engine"
    : usedFallback
      ? "Local fallback"
      : "Local engine";

  const agePts = toPoints(retirementAgeAnalysisResult, "retirementAge");
  const spendPts = toPoints(spendingAnalysisResult, "annualSpending");
  const ssPts = toPoints(ssAnalysisResult, "claimAge");

  return (
    <PageShell>
      <PageHeader
        title="Plan"
        actions={result ? (
          <Badge
            variant="secondary"
            className={cn(
              "gap-1.5",
              result.source === "server" && "bg-info/15 text-info",
              usedFallback && "bg-warn/15 text-warn",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                result.source === "server" ? "bg-info" : usedFallback ? "bg-warn" : "bg-muted-foreground",
              )}
            />
            {engineLabel}
          </Badge>
        ) : undefined}
      />

      <DashboardCard
        title="Levers"
        description={plan.socialSecurity.manualOverride
          ? "Your entered Social Security benefit applies only at that claim age, so its curve stays flat."
          : undefined}
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <LeverCard
            label="Planned / actual retirement age"
            value={plan.profile.retirementAge}
            display={`Age ${plan.profile.retirementAge}`}
            min={MIN_RETIREMENT_AGE}
            max={Math.min(100, plan.profile.lifeExpectancy - 1)}
            onChange={(v) => updatePlan({ profile: { retirementAge: v } })}
            points={agePts}
            xDomain={[45, 70]}
            xTicks={[45, 50, 55, 60, 65, 70]}
            xFormat={(v) => `Age ${v}`}
          />
          <LeverCard
            label="Annual spending"
            value={plan.profile.currentSpending}
            display={fmtCurrency(plan.profile.currentSpending)}
            min={20000}
            max={200000}
            step={1000}
            onChange={(v) => updatePlan({ profile: { currentSpending: v } })}
            points={spendPts}
            xDomain={[60_000, 120_000]}
            xTicks={[60_000, 80_000, 100_000, 120_000]}
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
            xDomain={[62, 70]}
            xTicks={[62, 64, 66, 68, 70]}
            xFormat={(v) => `Age ${v}`}
          />
        </div>
      </DashboardCard>

      <ProjectionsSection result={result} isSimulating={isUpdating} />

      <CashFlowCard profile={plan.profile} assumptions={plan.assumptions} />

    </PageShell>
  );
}
