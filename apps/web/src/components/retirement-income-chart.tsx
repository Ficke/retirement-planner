"use client";

import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { YearlyProjection } from '@/domain/types';
import { formatCurrency } from '@/lib/format';

interface RetirementIncomeChartProps {
  projections: YearlyProjection[];
}

export function RetirementIncomeChart({ projections }: RetirementIncomeChartProps) {
  const retirementData = useMemo(() => {
    return projections
      .filter(proj => proj.isRetired)
      .map((proj) => ({
        age: proj.age,
        year: proj.year,
        // All values stored in actual dollars
        socialSecurity: proj.socialSecurityBenefit,
        taxableWithdrawal: proj.withdrawalTaxable,
        traditionalWithdrawal: proj.withdrawalTraditional,
        rothWithdrawal: proj.withdrawalRoth,
        hsaWithdrawal: proj.withdrawalHSA,
        rmdAmount: proj.rmdAmount,
        totalSpending: proj.spending,
      }));
  }, [projections]);
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const totalIncome = data.socialSecurity + data.taxableWithdrawal + data.traditionalWithdrawal + data.rothWithdrawal + data.hsaWithdrawal;
      
      return (
        <div className="bg-background border rounded-lg p-4 shadow-lg">
          <p className="font-medium mb-2">Age {label}</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Social Security:</span>
              <span className="font-medium text-blue-600">{formatCurrency(data.socialSecurity, true)}</span>
            </div>
            <div className="flex justify-between">
              <span>Taxable Withdrawal:</span>
              <span className="font-medium text-green-600">{formatCurrency(data.taxableWithdrawal, true)}</span>
            </div>
            <div className="flex justify-between">
              <span>401(k)/Trad IRA:</span>
              <span className="font-medium text-orange-600">{formatCurrency(data.traditionalWithdrawal, true)}</span>
            </div>
            <div className="flex justify-between">
              <span>Roth Withdrawal:</span>
              <span className="font-medium text-purple-600">{formatCurrency(data.rothWithdrawal, true)}</span>
            </div>
            <div className="flex justify-between">
              <span>HSA Withdrawal:</span>
              <span className="font-medium text-cyan-600">{formatCurrency(data.hsaWithdrawal, true)}</span>
            </div>
            {data.rmdAmount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>RMD Required:</span>
                <span className="font-medium">{formatCurrency(data.rmdAmount, true)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t">
              <span className="font-medium">Total Income:</span>
              <span className="font-bold">{formatCurrency(totalIncome, true)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Total Spending:</span>
              <span className="font-bold">{formatCurrency(data.totalSpending, true)}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };
  
  if (retirementData.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Run simulation to see retirement income breakdown</p>
      </div>
    );
  }
  
  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={retirementData} margin={{ top: 20, right: 30, left: 60, bottom: 20 }}>
        <defs>
          <linearGradient id="socialSecurityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.3} />
          </linearGradient>
          <linearGradient id="taxableGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.3} />
          </linearGradient>
          <linearGradient id="traditionalGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.3} />
          </linearGradient>
          <linearGradient id="rothGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.3} />
          </linearGradient>
          <linearGradient id="hsaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        
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
            // Scale actual dollars for display readability
            const val = Number(value);
            if (val >= 1000000) return `$${Math.round(val/1000000)}M`;
            if (val >= 1000) return `$${Math.round(val/1000)}K`;
            return `$${Math.round(val)}`;
          }}
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickLine={{ stroke: 'hsl(var(--border))' }}
        />
        
        <Tooltip content={customTooltip} />
        <Legend 
          wrapperStyle={{
            paddingTop: '20px',
            fontSize: '12px',
            color: 'hsl(var(--muted-foreground))'
          }}
        />
        
        <Area
          type="monotone"
          dataKey="socialSecurity"
          stackId="1"
          stroke="#3b82f6"
          fill="url(#socialSecurityGradient)"
          name="Social Security"
        />
        
        <Area
          type="monotone"
          dataKey="taxableWithdrawal"
          stackId="1"
          stroke="#10b981"
          fill="url(#taxableGradient)"
          name="Taxable Brokerage"
        />
        
        <Area
          type="monotone"
          dataKey="traditionalWithdrawal"
          stackId="1"
          stroke="#f59e0b"
          fill="url(#traditionalGradient)"
          name="401(k)/Traditional IRA"
        />
        
        <Area
          type="monotone"
          dataKey="rothWithdrawal"
          stackId="1"
          stroke="#8b5cf6"
          fill="url(#rothGradient)"
          name="Roth IRA"
        />
        
        <Area
          type="monotone"
          dataKey="hsaWithdrawal"
          stackId="1"
          stroke="#06b6d4"
          fill="url(#hsaGradient)"
          name="HSA"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}