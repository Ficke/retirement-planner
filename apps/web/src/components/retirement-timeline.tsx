"use client";

import { useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import type { YearlyProjection } from '@/domain/types';
import { TimelineTooltip } from './timeline-tooltip';

interface RetirementTimelineProps {
  projections: YearlyProjection[];
}

export function RetirementTimeline({ projections }: RetirementTimelineProps) {
  const chartData = useMemo(() => {
    return projections.map((proj) => ({
      age: proj.age,
      year: proj.year,
      // All values stored in actual dollars - use projection engine values directly
      portfolioValue: proj.portfolioValue,
      income: proj.isRetired ? null : proj.income,
      spending: proj.spending,
      taxes: proj.taxes,
      savings: proj.savings,
      rmdAmount: proj.rmdAmount || 0,
      phase: proj.isRetired ? 'Retirement' : 'Working',
      isRetired: proj.isRetired,
    }));
  }, [projections]);
  
  const retirementAge = projections.find(p => p.isRetired)?.age || 65;
  const minAge = projections[0]?.age || 25;
  const maxAge = projections[projections.length - 1]?.age || 95;
  
  
  if (chartData.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No projection data available for timeline</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 80, left: 80, bottom: 60 }}>
          <CartesianGrid 
            strokeDasharray="2 4" 
            className="opacity-20" 
            stroke="hsl(var(--border))"
          />
          
          {/* Phase background areas */}
          <ReferenceArea
            x1={minAge}
            x2={retirementAge}
            fill="#10b981"
            fillOpacity={0.05}
          />
          <ReferenceArea
            x1={retirementAge}
            x2={maxAge}
            fill="#3b82f6"
            fillOpacity={0.05}
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
            domain={[0, 'dataMax']}
            tickFormatter={(value) => {
              const val = Number(value);
              // Scale actual dollars for display readability
              if (val >= 1000000) return `$${Math.round(val/1000000)}M`;
              if (val >= 1000) return `$${Math.round(val/1000)}K`;
              return `$${Math.round(val)}`;
            }}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
          />
          
          <Tooltip content={<TimelineTooltip />} />
          <Legend 
            wrapperStyle={{
              paddingTop: '20px',
              fontSize: '12px',
              color: 'hsl(var(--muted-foreground))'
            }}
          />
          
          {/* Reference line at retirement age */}
          <ReferenceLine 
            x={retirementAge} 
            stroke="#6b7280" 
            strokeDasharray="2 2"
            strokeOpacity={0.6}
          />
          
          
          {/* Work income line (only during working years) */}
          <Line
            type="monotone"
            dataKey="income"
            stroke="#10b981"
            strokeWidth={3}
            dot={false}
            name="Work Income"
            connectNulls={false}
          />
          
          {/* Spending line */}
          <Line
            type="monotone"
            dataKey="spending"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={false}
            name="Annual Spending"
            strokeDasharray="5 3"
          />
          
          {/* Taxes line */}
          <Line
            type="monotone"
            dataKey="taxes"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            name="Annual Taxes"
            strokeDasharray="3 2"
          />
        </ComposedChart>
      </ResponsiveContainer>
      
    </div>
  );
}