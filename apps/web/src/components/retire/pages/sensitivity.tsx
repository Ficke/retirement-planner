"use client";

import { usePlan } from "@/state/usePlan";
import type { SimulationResult } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DashboardCard,
  PageHeader,
  PageShell,
} from "@/components/retire/ui";
import { SensitivityChart } from "@/components/ui/charts";
import { fmtCurrency, fmtPercent } from "../format";
import { cn } from "@/lib/utils";

type Point = { x: number; y: number };

export function PageSensitivity() {
  const {
    plan,
    ssAnalysisResult,
    spendingAnalysisResult,
    retirementAgeAnalysisResult,
  } = usePlan();
  const isSimulating = usePlan(
    (s) => s.isSimulatingSS || s.isSimulatingSpending || s.isSimulatingRetirementAge,
  );

  const agePts = toPoints(retirementAgeAnalysisResult, "retirementAge");
  const spendPts = toPoints(spendingAnalysisResult, "annualSpending");
  const ssPts = toPoints(ssAnalysisResult, "claimAge");

  return (
    <PageShell>
      <PageHeader
        title="Sensitivity"
        description="How success probability moves as each lever sweeps across its range. Holds the other two at your current plan."
        actions={
          <Badge
            variant="secondary"
            className={cn(
              "gap-1.5",
              isSimulating ? "bg-warn/15 text-warn" : "bg-success/15 text-success",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isSimulating ? "bg-warn" : "bg-success",
              )}
            />
            {isSimulating ? "Recalculating" : "Up to date"}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SensitivityCard
          title="Retirement age"
          xLabel="Age"
          xFormat={(v) => `Age ${v}`}
          points={agePts}
          marker={plan.profile.retirementAge}
        />
        <SensitivityCard
          title="Annual spending"
          xLabel="Spending"
          xFormat={(v) => fmtCurrency(v, true)}
          points={spendPts}
          marker={plan.profile.desiredSpending}
        />
        <SensitivityCard
          title="Social Security claim age"
          xLabel="Age"
          xFormat={(v) => `Age ${v}`}
          points={ssPts}
          marker={plan.socialSecurity.claimAge}
        />
      </div>
    </PageShell>
  );
}

function toPoints<T>(arr: T[] | null | undefined, xKey: keyof T): Point[] {
  if (!arr) return [];
  return arr
    .map((item) => ({
      x: item[xKey] as unknown as number,
      y: (item as unknown as { result: SimulationResult }).result.successProbability,
    }))
    .sort((a, b) => a.x - b.x);
}

function SensitivityCard({
  title,
  xLabel,
  xFormat,
  points,
  marker,
}: {
  title: string;
  xLabel: string;
  xFormat: (v: number) => string;
  points: Point[];
  marker: number;
}) {
  const inRange =
    points.length > 0 && marker >= points[0].x && marker <= points[points.length - 1].x;

  let markerY: number | null = null;
  if (inRange) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (marker >= a.x && marker <= b.x) {
        const t = (marker - a.x) / (b.x - a.x || 1);
        markerY = a.y + t * (b.y - a.y);
        break;
      }
    }
    if (markerY == null) markerY = points[points.length - 1].y;
  }

  return (
    <DashboardCard title={title}>
      {points.length === 0 ? (
        <Skeleton className="h-[200px] w-full" />
      ) : (
        <div className="flex flex-col gap-2">
          <SensitivityChart
            points={points}
            marker={inRange && markerY != null ? { x: marker, y: markerY } : undefined}
            xLabel={xLabel}
            xFormat={xFormat}
          />
          <div className="text-muted-foreground flex justify-between text-xs">
            <span>{xLabel}</span>
            <span className="font-mono">
              Current: {xFormat(marker)} ·{" "}
              {inRange && markerY != null ? fmtPercent(markerY, 0) : "outside swept range"}
            </span>
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
