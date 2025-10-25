"use client";

import { ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, Legend, ReferenceLine, ReferenceArea } from 'recharts';
import type { YearlyProjection } from '@/domain/types';
import { useWealthChartData, useChartDomain } from '@/lib/chart-utils';
import { WealthTooltip } from './wealth-tooltip';
import { cn } from '@/lib/utils';

interface WealthChartProps {
  projections: YearlyProjection[];
  showPercentiles?: boolean;
  className?: string;
}

export function WealthChart({ projections, showPercentiles = false, className }: WealthChartProps) {
  const chartData = useWealthChartData(projections);
  const [domainMin, domainMax] = useChartDomain(chartData);
  
  const retirementAge = projections.find(p => p.isRetired)?.age || 65;
  const earlyRetirementEnd = Math.min(67, projections[projections.length - 1]?.age || 95);
  const minAge = projections[0]?.age || 25;
  const maxAge = projections[projections.length - 1]?.age || 95;

  if (showPercentiles) {
    return (
      <div className={cn("w-full", className)}>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart 
            data={chartData} 
            margin={{ top: 20, right: 30, left: 80, bottom: 60 }}
          >
            <defs>
              <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.2} />
                <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            
            <CartesianGrid 
              strokeDasharray="2 4" 
              className="opacity-20" 
              stroke="hsl(var(--border))"
            />
            
            {/* Phase background areas */}
            <ReferenceArea
              x1={minAge}
              x2={retirementAge}
              fill="hsl(var(--phase-working))"
              fillOpacity={0.03}
            />
            <ReferenceArea
              x1={retirementAge}
              x2={earlyRetirementEnd}
              fill="hsl(var(--phase-early))"
              fillOpacity={0.03}
            />
            <ReferenceArea
              x1={earlyRetirementEnd}
              x2={maxAge}
              fill="hsl(var(--phase-full))"
              fillOpacity={0.03}
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
            
            {/* 25th-75th percentile confidence band */}
            <Area
              type="monotone"
              dataKey="p75"
              stroke="none"
              fill="hsl(var(--chart-2) / 0.15)"
              name="Confidence range (25th-75th)"
            />
            <Area
              type="monotone"
              dataKey="p25"
              stroke="none"
              fill="hsl(var(--background))"
              name=""
            />
            
            {/* 75th percentile line */}
            <Line
              type="monotone"
              dataKey="p75"
              stroke="hsl(var(--wealth-success))"
              strokeWidth={1.5}
              strokeDasharray="3 2"
              dot={false}
              name="Good case (75th)"
            />
            
            {/* 25th percentile line */}
            <Line
              type="monotone"
              dataKey="p25"
              stroke="hsl(var(--wealth-warning))"
              strokeWidth={1.5}
              strokeDasharray="3 2"
              dot={false}
              name="Conservative case (25th)"
            />
            
            {/* Median line (most prominent) */}
            <Line
              type="monotone"
              dataKey="p50"
              stroke="hsl(var(--wealth-median))"
              strokeWidth={3}
              dot={false}
              name="Expected outcome (median)"
              activeDot={{ 
                r: 6, 
                fill: 'hsl(var(--wealth-median))',
                stroke: 'hsl(var(--background))',
                strokeWidth: 2
              }}
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
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 80, bottom: 20 }}>
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
            stroke="hsl(var(--wealth-median))"
            strokeWidth={3}
            dot={false}
            activeDot={{ 
              r: 6, 
              fill: 'hsl(var(--wealth-median))',
              stroke: 'hsl(var(--background))',
              strokeWidth: 2
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}