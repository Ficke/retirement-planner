"use client";

import { formatCurrency } from '@/lib/format';

interface TimelineTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    dataKey: string;
    color: string;
    name: string;
    payload: Record<string, number>;
  }>;
  label?: string | number;
}

export function TimelineTooltip({ active, payload, label }: TimelineTooltipProps) {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;
  
  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-lg">
      <div className="mb-3">
        <p className="font-semibold text-card-foreground">Age {label}</p>
        <p className="text-sm text-muted-foreground">{data.phase} Phase</p>
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Portfolio Value:</span>
          <span className="font-bold text-wealth-median">{formatCurrency(data.portfolioValue, true)}</span>
        </div>
        
        <hr className="border-border/50" />
        
        <div className="flex justify-between">
          <span className="text-muted-foreground">Annual Income:</span>
          <span className="font-medium text-wealth-success">{formatCurrency(data.income, true)}</span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-muted-foreground">Annual Spending:</span>
          <span className="font-medium text-blue-600">{formatCurrency(data.spending, true)}</span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-muted-foreground">Annual Taxes:</span>
          <span className="font-medium text-wealth-warning">{formatCurrency(data.taxes, true)}</span>
        </div>
        
        {data.rmdAmount > 0 && (
          <div className="flex justify-between text-yellow-600">
            <span>RMD Required:</span>
            <span className="font-medium">{formatCurrency(data.rmdAmount, true)}</span>
          </div>
        )}
        
        <hr className="border-border/50" />
        
        <div className="flex justify-between">
          <span className={data.savings >= 0 ? 'text-wealth-success' : 'text-wealth-warning'}>
            {data.savings >= 0 ? 'Net Savings:' : 'Net Withdrawal:'}
          </span>
          <span className={`font-bold ${data.savings >= 0 ? 'text-wealth-success' : 'text-wealth-warning'}`}>
            {formatCurrency(Math.abs(data.savings), true)}
          </span>
        </div>
      </div>
    </div>
  );
}