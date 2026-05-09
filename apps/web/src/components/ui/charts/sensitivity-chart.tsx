"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtPercent } from "@/components/retire/format";

const config = {
  y: { label: "Success", color: "var(--color-success)" },
} as const;

export function SensitivityChart({
  points,
  marker,
  xLabel,
  xFormat = (v) => String(v),
  height = 200,
}: {
  points: { x: number; y: number }[];
  marker?: { x: number; y: number };
  xLabel?: string;
  xFormat?: (v: number) => string;
  height?: number;
}) {
  if (!points || points.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center text-sm" style={{ height }}>
        —
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <LineChart data={points} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 3" />
        <XAxis
          dataKey="x"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={xFormat}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          label={
            xLabel
              ? { value: xLabel, position: "insideBottom", offset: -2, fontSize: 11 }
              : undefined
          }
        />
        <YAxis
          tickFormatter={(v) => fmtPercent(v)}
          domain={[0, 1]}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={48}
        />
        <Line
          type="monotone"
          dataKey="y"
          stroke="var(--color-y)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {marker && (
          <ReferenceDot
            x={marker.x}
            y={marker.y}
            r={5}
            fill="var(--color-success)"
            stroke="var(--color-card)"
            strokeWidth={2}
          />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--color-foreground)", strokeOpacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => xFormat(Number(label))}
              formatter={(value) => (
                <span className="font-mono">Success: {fmtPercent(Number(value))}</span>
              )}
            />
          }
        />
      </LineChart>
    </ChartContainer>
  );
}
