"use client";

import { useMemo, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import type { YearlyProjection } from '@/domain/types';
import { formatCurrency } from '@/lib/format';

interface WealthChartProps {
  projections: YearlyProjection[];
  showPercentiles?: boolean;
}


export function WealthChart({ projections, showPercentiles = false }: WealthChartProps) {
  const chartData = useMemo(() => {
    return projections.map((proj) => ({
      age: proj.age,
      year: proj.year,
      wealth: proj.portfolioValue,
      p10: proj.p10,
      p25: proj.p25,
      p50: proj.p50,
      p75: proj.p75,
      p90: proj.p90,
      phase: proj.isRetired ? 'Retirement' : 'Working',
    }));
  }, [projections]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = useCallback(({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium">Age {label}</p>
          <p className="text-sm text-muted-foreground mb-2">{data.phase}</p>
          {showPercentiles ? (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>90th percentile:</span>
                <span className="font-medium">{formatCurrency(data.p90, true)}</span>
              </div>
              <div className="flex justify-between">
                <span>Median:</span>
                <span className="font-medium">{formatCurrency(data.p50, true)}</span>
              </div>
              <div className="flex justify-between">
                <span>10th percentile:</span>
                <span className="font-medium">{formatCurrency(data.p10, true)}</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-between text-sm">
              <span>Portfolio Value:</span>
              <span className="font-medium">{formatCurrency(data.wealth, true)}</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  }, [showPercentiles]);

  if (showPercentiles) {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 80, bottom: 20 }}>
          <defs>
            <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="innerBandGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.15} />
            </linearGradient>
          </defs>
          
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          
          <XAxis 
            dataKey="age" 
            type="number"
            scale="linear"
            domain={['dataMin', 'dataMax']}
            className="text-xs"
          />
          
          <YAxis 
            tickFormatter={(value) => formatCurrency(value, true)}
            className="text-xs"
          />
          
          <Tooltip content={customTooltip} />
          
          {/* 10th-90th percentile band */}
          <Area
            type="monotone"
            dataKey="p90"
            stroke="none"
            fill="url(#confidenceGradient)"
          />
          
          {/* 25th-75th percentile band (inner confidence) */}
          <Area
            type="monotone"
            dataKey="p75"
            stroke="none"
            fill="url(#innerBandGradient)"
          />
          
          {/* Percentile lines */}
          <Line
            type="monotone"
            dataKey="p90"
            stroke="#93c5fd"
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
            name="90th percentile"
          />
          
          <Line
            type="monotone"
            dataKey="p75"
            stroke="#60a5fa"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            name="75th percentile"
          />
          
          {/* Median line (prominent) */}
          <Line
            type="monotone"
            dataKey="p50"
            stroke="#2563eb"
            strokeWidth={3}
            dot={false}
            name="Median (50th percentile)"
          />
          
          <Line
            type="monotone"
            dataKey="p25"
            stroke="#60a5fa"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            name="25th percentile"
          />
          
          <Line
            type="monotone"
            dataKey="p10"
            stroke="#93c5fd"
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
            name="10th percentile"
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
        <defs>
          <linearGradient id="retirementGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--destructive))" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis 
          dataKey="age" 
          type="number"
          scale="linear"
          domain={['dataMin', 'dataMax']}
          className="text-xs"
        />
        <YAxis 
          tickFormatter={(value) => formatCurrency(value, true)}
          className="text-xs"
        />
        <Tooltip content={customTooltip} />
        
        <Line
          type="monotone"
          dataKey="wealth"
          stroke="url(#retirementGradient)"
          strokeWidth={3}
          dot={false}
          activeDot={{ r: 6, fill: "hsl(var(--primary))" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}