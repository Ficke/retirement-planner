"use client";

import type { YearlyProjection } from "@/domain/types";
import { fmtCurrency } from "@/components/retire/format";

type Pick7 = Pick<YearlyProjection, "p5" | "p10" | "p25" | "p50" | "p75" | "p90">;

export function PercentileBars({ projections }: { projections: Pick7[] }) {
  if (!projections || projections.length === 0) return null;
  const last = projections[projections.length - 1];
  const buckets = [
    { label: "5th", value: last.p5, color: "var(--color-danger)" },
    { label: "10th", value: last.p10, color: "var(--color-warn)" },
    { label: "25th", value: last.p25, color: "var(--color-account-ss)" },
    { label: "50th", value: last.p50, color: "var(--color-success)" },
    { label: "75th", value: last.p75, color: "var(--color-account-hsa)" },
    { label: "90th", value: last.p90, color: "var(--color-info)" },
  ];
  const max = Math.max(...buckets.map((b) => b.value), 1);
  return (
    <div className="flex h-[140px] items-end gap-2">
      {buckets.map((b) => (
        <div
          key={b.label}
          className="flex h-full flex-1 flex-col items-center gap-1.5"
        >
          <div className="flex w-full flex-1 items-end">
            <div
              className="relative w-full rounded-t-sm transition-[height] duration-300"
              style={{ height: `${(b.value / max) * 100}%`, background: b.color }}
            >
              <div className="text-foreground/80 absolute -top-4 right-0 left-0 text-center font-mono text-[10.5px] font-semibold">
                {fmtCurrency(b.value, true)}
              </div>
            </div>
          </div>
          <div className="text-muted-foreground font-mono text-[10px]">{b.label}</div>
        </div>
      ))}
    </div>
  );
}
