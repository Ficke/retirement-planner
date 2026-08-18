"use client";

import { useEffect } from "react";
import { usePlan } from "@/state/usePlan";
import { leverRange, type LeverKey } from "@/domain/levers";
import type { SimulationSummary } from "@/domain/types";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/retire/ui";
import { SensitivityChart } from "@/components/ui/charts";
import {
  ProjectionDetails,
  ProjectionSummary,
} from "@/components/retire/pages/projections";
import { fmtCurrency } from "../format";
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
 * Displays a plan lever with a slider and a sensitivity curve; the marker
 * identifies the plan's current value.
 */
function LeverCard({
  lever,
  label,
  value,
  display,
  onChange,
  points,
  xFormat,
  xTooltipFormat,
  note,
  isCalculating,
}: {
  lever: LeverKey;
  label: string;
  value: number;
  display: string;
  onChange: (v: number) => void;
  points: Point[];
  xFormat: (v: number) => string;
  xTooltipFormat: (v: number) => string;
  note?: string;
  isCalculating?: boolean;
}) {
  const plan = usePlan((s) => s.plan);
  const { min, max, step, ticks } = leverRange(lever, plan);
  const xDomain: [number, number] = [min, max];
  const inRange = points.length > 0 && value >= min && value <= max;

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
        <div className={cn(
          "flex flex-col gap-1 transition-opacity",
          isCalculating && "opacity-50",
        )}>
          <SensitivityChart
            points={points}
            marker={inRange && markerY != null ? { x: value, y: markerY } : undefined}
            xLabel={label}
            xDomain={xDomain}
            xTicks={ticks}
            xFormat={xFormat}
            xTooltipFormat={xTooltipFormat}
            height={176}
          />
          {note && <div className="text-muted-foreground text-[11px]">{note}</div>}
        </div>
      )}
    </div>
  );
}

export function PagePlan() {
  const plan = usePlan((s) => s.plan);
  const result = usePlan((s) => s.simulationResult);
  const resultPlan = usePlan((s) => s.simulationPlan);
  const isCalculating = usePlan((s) => s.isSimulatingMain || s.simulationPending);
  const useServerSideCalculations = usePlan((s) => s.useServerSideCalculations);
  const updatePlan = usePlan((s) => s.updatePlan);
  const ssAnalysisResult = usePlan((s) => s.ssAnalysisResult);
  const spendingAnalysisResult = usePlan((s) => s.spendingAnalysisResult);
  const retirementAgeAnalysisResult = usePlan((s) => s.retirementAgeAnalysisResult);
  const isSimulatingSensitivities = usePlan((s) => s.isSimulatingSensitivities);
  const sensitivityPending = usePlan((s) => s.sensitivityPending);
  const runSensitivityAnalyses = usePlan((s) => s.runSensitivityAnalyses);

  // Sensitivity sweeps are expensive and only this page displays them. Load
  // the three curves together so cloud mode uses one bounded batch request.
  useEffect(() => {
    const missingCurves = ssAnalysisResult === null
      && spendingAnalysisResult === null
      && retirementAgeAnalysisResult === null;
    if (!isSimulatingSensitivities && (sensitivityPending || missingCurves)) {
      const timeout = window.setTimeout(() => void runSensitivityAnalyses(), 500);
      return () => window.clearTimeout(timeout);
    }
  }, [
    plan,
    isSimulatingSensitivities,
    sensitivityPending,
    ssAnalysisResult,
    spendingAnalysisResult,
    retirementAgeAnalysisResult,
    runSensitivityAnalyses,
  ]);

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

      <ProjectionSummary result={result} resultPlan={resultPlan} isCalculating={isCalculating} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <LeverCard
          lever="retirementAge"
          label="Retirement age"
          value={plan.profile.retirementAge}
          display={`Age ${plan.profile.retirementAge}`}
          onChange={(v) => updatePlan({ profile: { retirementAge: v } })}
          points={agePts}
          isCalculating={isSimulatingSensitivities}
          xFormat={String}
          xTooltipFormat={(v) => `Retirement age: ${v}`}
        />
        <LeverCard
          lever="spending"
          label="Annual spending"
          value={plan.profile.currentSpending}
          display={fmtCurrency(plan.profile.currentSpending)}
          onChange={(v) => updatePlan({ profile: { currentSpending: v } })}
          points={spendPts}
          isCalculating={isSimulatingSensitivities}
          xFormat={(v) => fmtCurrency(v, true)}
          xTooltipFormat={(v) => `Annual spending: ${fmtCurrency(v)}`}
        />
        <LeverCard
          lever="socialSecurityClaimAge"
          label="Social Security claim age"
          value={plan.socialSecurity.claimAge}
          display={`Age ${plan.socialSecurity.claimAge}`}
          onChange={(v) => updatePlan({ socialSecurity: { claimAge: v } })}
          points={ssPts}
          isCalculating={isSimulatingSensitivities}
          xFormat={String}
          xTooltipFormat={(v) => `Social Security claim age: ${v}`}
          note={plan.socialSecurity.manualOverride
            ? "The entered benefit applies at the selected claim age, so this curve remains flat."
            : undefined}
        />
      </div>

      <ProjectionDetails result={result} isSimulating={isCalculating} />

    </PageShell>
  );
}
