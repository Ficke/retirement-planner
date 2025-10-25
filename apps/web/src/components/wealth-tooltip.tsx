"use client";

import { formatCurrency } from '@/lib/format';
import type { WealthChartDataPoint } from '@/lib/chart-utils';

interface WealthTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    dataKey: string;
    color: string;
    name: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  showAllPercentiles?: boolean;
}

export function WealthTooltip({ 
  active, 
  payload, 
  label, 
  showAllPercentiles = true 
}: WealthTooltipProps) {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload as unknown as WealthChartDataPoint;
  
  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-lg">
      <div className="mb-3">
        <p className="font-semibold text-card-foreground">Age {label}</p>
        <p className="text-sm text-muted-foreground">{data.phase} Phase</p>
      </div>
      
      {showAllPercentiles ? (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-muted-foreground">90th %:</span>
            <span className="font-medium" style={{color: '#10b981'}}>{formatCurrency(data.p90, true)}</span>

            <span className="text-muted-foreground">75th %:</span>
            <span className="font-medium" style={{color: '#34d399'}}>{formatCurrency(data.p75, true)}</span>

            <span className="text-card-foreground font-medium">50th % (median):</span>
            <span className="font-bold" style={{color: '#3b82f6'}}>{formatCurrency(data.p50, true)}</span>

            <span className="text-muted-foreground">25th %:</span>
            <span className="font-medium" style={{color: '#fbbf24'}}>{formatCurrency(data.p25, true)}</span>

            <span className="text-muted-foreground">15th %:</span>
            <span className="font-medium" style={{color: '#f97316'}}>{formatCurrency(data.p15, true)}</span>

            <span className="text-muted-foreground">10th %:</span>
            <span className="font-medium" style={{color: '#ea580c'}}>{formatCurrency(data.p10, true)}</span>

            <span className="text-muted-foreground">5th %:</span>
            <span className="font-medium" style={{color: '#dc2626'}}>{formatCurrency(data.p5, true)}</span>
          </div>
        </div>
      ) : (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Portfolio Value:</span>
          <span className="font-bold">{formatCurrency(data.wealth, true)}</span>
        </div>
      )}
    </div>
  );
}