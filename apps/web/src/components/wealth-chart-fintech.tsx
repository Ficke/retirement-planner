"use client";

import { useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from 'recharts';
import type { YearlyProjection } from '@/domain/types';
import { WealthTooltip } from './wealth-tooltip';
import { cn } from '@/lib/utils';

interface WealthChartProps {
  projections: YearlyProjection[];
  showPercentiles?: boolean;
  className?: string;
}

export function WealthChart({ projections, showPercentiles = false, className }: WealthChartProps) {
  const chartData = useMemo(() => {
    return projections.map((proj) => ({
      age: proj.age,
      year: proj.year,
      wealth: proj.portfolioValue,
      p5: proj.p5,
      p10: proj.p10,
      p15: proj.p15,
      p25: proj.p25,
      p50: proj.p50,
      p75: proj.p75,
      p90: proj.p90,
      // For proper area fill between 25th and 75th
      confidenceRange: [proj.p25, proj.p75],
      phase: proj.isRetired ? 'Retirement' : 'Working',
      isRetired: proj.isRetired,
    }));
  }, [projections]);
  
  const retirementAge = projections.find(p => p.isRetired)?.age || 65;
  const earlyRetirementEnd = Math.min(67, projections[projections.length - 1]?.age || 95);
  const minAge = projections[0]?.age || 25;
  const maxAge = projections[projections.length - 1]?.age || 95;

  // Calculate domain based on visible percentiles
  const [domainMin, domainMax] = useMemo(() => {
    if (chartData.length === 0) return [0, 1000000];

    const allValues = chartData.flatMap(d => showPercentiles ? [d.p5, d.p90] : [d.wealth]);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);

    const padding = (max - min) * 0.15; // More padding for better visualization
    return [Math.max(0, min - padding), max + padding];
  }, [chartData, showPercentiles]);

  if (showPercentiles) {
    return (
      <div className={cn("w-full", className)}>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart 
            data={chartData} 
            margin={{ top: 20, right: 30, left: 80, bottom: 60 }}
          >
            <defs>
              {/* Modern fintech gradient for confidence band */}
              <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            
            <CartesianGrid 
              strokeDasharray="2 4" 
              className="opacity-20" 
              stroke="hsl(var(--border))"
            />
            
            {/* Subtle phase background areas */}
            <ReferenceArea
              x1={minAge}
              x2={retirementAge}
              fill="#10b981"
              fillOpacity={0.02}
            />
            <ReferenceArea
              x1={retirementAge}
              x2={earlyRetirementEnd}
              fill="#3b82f6"
              fillOpacity={0.02}
            />
            <ReferenceArea
              x1={earlyRetirementEnd}
              x2={maxAge}
              fill="#8b5cf6"
              fillOpacity={0.02}
            />
            
            <XAxis 
              dataKey="age" 
              type="number"
              scale="linear"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={{ stroke: 'hsl(var(--border))' }}
            />
            
            <YAxis 
              domain={[domainMin, domainMax]}
              tickFormatter={(value) => {
                const val = Number(value);
                if (val >= 1000000) return `$${(val/1000000).toFixed(1)}M`;
                if (val >= 1000) return `$${(val/1000).toFixed(0)}k`;
                return `$${val.toFixed(0)}`;
              }}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={{ stroke: 'hsl(var(--border))' }}
            />
            
            <Tooltip content={<WealthTooltip showAllPercentiles={showPercentiles} />} />
            
            <Legend 
              wrapperStyle={{
                paddingTop: '20px',
                fontSize: '12px',
                color: 'hsl(var(--muted-foreground))'
              }}
            />
            
            {/* Retirement age reference line */}
            <ReferenceLine 
              x={retirementAge}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              label={{ 
                value: "Retirement", 
                position: "top",
                style: { fontSize: '12px', fill: 'hsl(var(--muted-foreground))' }
              }}
            />
            
            {/* 90th percentile - Best case (green) */}
            <Line
              type="monotone"
              dataKey="p90"
              stroke="#10b981"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
              name="90th %"
            />

            {/* 75th percentile (light green) */}
            <Line
              type="monotone"
              dataKey="p75"
              stroke="#34d399"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
              name="75th %"
            />

            {/* Median line (blue - most prominent) */}
            <Line
              type="monotone"
              dataKey="p50"
              stroke="#3b82f6"
              strokeWidth={4}
              dot={false}
              name="50th %"
              activeDot={{
                r: 8,
                fill: '#3b82f6',
                stroke: 'hsl(var(--background))',
                strokeWidth: 3
              }}
            />

            {/* 25th percentile (yellow) */}
            <Line
              type="monotone"
              dataKey="p25"
              stroke="#fbbf24"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
              name="25th %"
            />

            {/* 15th percentile (orange) */}
            <Line
              type="monotone"
              dataKey="p15"
              stroke="#f97316"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
              name="15th %"
            />

            {/* 10th percentile (dark orange) */}
            <Line
              type="monotone"
              dataKey="p10"
              stroke="#ea580c"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
              name="10th %"
            />

            {/* 5th percentile - Worst case (red) */}
            <Line
              type="monotone"
              dataKey="p5"
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
              name="5th %"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Simple view without percentiles
  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 80, bottom: 20 }}>
          <CartesianGrid 
            strokeDasharray="2 4" 
            className="opacity-20"
            stroke="hsl(var(--border))"
          />
          
          <XAxis 
            dataKey="age" 
            type="number"
            scale="linear"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
          />
          
          <YAxis 
            tickFormatter={(value) => {
              const val = Number(value);
              if (val >= 1000000) return `$${(val/1000000).toFixed(1)}M`;
              if (val >= 1000) return `$${(val/1000).toFixed(0)}k`;
              return `$${val.toFixed(0)}`;
            }}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
          />
          
          <Tooltip content={<WealthTooltip showAllPercentiles={showPercentiles} />} />
          
          <Line
            type="monotone"
            dataKey="wealth"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={false}
            activeDot={{ 
              r: 6, 
              fill: '#3b82f6',
              stroke: 'hsl(var(--background))',
              strokeWidth: 2
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}