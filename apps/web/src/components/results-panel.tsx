"use client";

import { usePlan } from '@/state/usePlan';
import { useSimulationState } from '@/hooks/useSimulationState';
import { formatCurrency, formatPercent } from '@/lib/format';
import { WealthChart } from '@/components/wealth-chart-fintech';
import { RetirementTimeline } from '@/components/retirement-timeline';
import { RetirementIncomeChart } from '@/components/retirement-income-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

export function ResultsPanel() {
  const { simulationResult } = usePlan();
  const { isSimulationRunning } = useSimulationState();
  const [isTableExpanded, setIsTableExpanded] = useState(false);

  // Check if main simulation is running
  const isMainSimulationRunning = isSimulationRunning('main');

  // Helper function to get stable CSS classes for positive/negative values
  const getFlowClassName = (value: number) =>
    `text-right text-sm font-mono font-medium ${value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`;

  // Memoize table row calculations to prevent re-computation on hover
  const tableRowData = useMemo(() => {
    if (!simulationResult) return [];

    return simulationResult.yearlyProjections.map((projection, index) => {
      // Calculate external income (salary + SS)
      const externalIncome = projection.income + projection.socialSecurityBenefit;

      // Calculate net flow for each account type (deposits are positive, withdrawals are negative)
      const taxableFlow = projection.depositTaxable - projection.withdrawalTaxable;
      const traditionalFlow = projection.depositTraditional - projection.withdrawalTraditional;
      const rothFlow = projection.depositRoth - projection.withdrawalRoth;
      const hsaFlow = projection.depositHSA - projection.withdrawalHSA;

      // Calculate rate of return from previous year
      const previousProjection = index > 0 ? simulationResult.yearlyProjections[index - 1] : null;
      let rateOfReturn = 0;
      if (previousProjection && previousProjection.portfolioValue > 0) {
        // Total new cash added this year
        const totalCashAdded = projection.savings;
        // Portfolio growth = current value - previous value - cash added
        const portfolioGrowth = projection.portfolioValue - previousProjection.portfolioValue - totalCashAdded;
        // Rate of return = growth / previous portfolio value
        rateOfReturn = portfolioGrowth / previousProjection.portfolioValue;
      }

      // Pre-calculate CSS classes for stable rendering
      const phaseClassName = `inline-flex items-center text-xs px-2 py-1 rounded-full font-medium ${
        projection.isRetired ?
        'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' :
        'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
      }`;

      return {
        projection,
        index,
        externalIncome,
        taxableFlow,
        traditionalFlow,
        rothFlow,
        hsaFlow,
        rateOfReturn,
        previousProjection,
        // Pre-calculated classes
        phaseClassName,
        savingsClassName: getFlowClassName(projection.savings),
        taxableClassName: getFlowClassName(taxableFlow),
        traditionalClassName: getFlowClassName(traditionalFlow),
        rothClassName: getFlowClassName(rothFlow),
        hsaClassName: getFlowClassName(hsaFlow),
        returnClassName: getFlowClassName(rateOfReturn)
      };
    });
  }, [simulationResult]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulation Results</CardTitle>
        <CardDescription>
          Monte Carlo projections and success probability
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {isMainSimulationRunning ? (
          <div className="text-center py-12 min-h-[800px] flex items-center justify-center">
            <div>
              <div className="flex items-center justify-center space-x-2 text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin" />
                <span className="text-lg">Running Monte Carlo simulation...</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                This may take a few seconds
              </p>
            </div>
          </div>
        ) : simulationResult ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Retirement Outcomes</CardTitle>
                <CardDescription>Terminal wealth distribution and success probability</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Success Probability - takes 1 column */}
                  <div className="md:col-span-1">
                    <div className={`rounded-lg p-6 h-full flex flex-col justify-center ${simulationResult.successProbability >= 0.85 ? 'bg-green-50 dark:bg-green-950/30' : simulationResult.successProbability >= 0.75 ? 'bg-yellow-50 dark:bg-yellow-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}>
                      <div className="text-sm font-medium text-muted-foreground mb-2">
                        Success Probability
                      </div>
                      <div className={`text-5xl font-bold mb-2 ${simulationResult.successProbability >= 0.85 ? 'text-green-600 dark:text-green-400' : simulationResult.successProbability >= 0.75 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatPercent(simulationResult.successProbability)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {simulationResult.successProbability >= 0.85 ? 'Excellent outlook' : simulationResult.successProbability >= 0.75 ? 'Good with room to improve' : 'Needs attention'}
                      </div>
                    </div>
                  </div>

                  {/* Terminal Wealth Distribution - takes 2 columns */}
                  <div className="md:col-span-2 flex flex-col">
                    <div className="text-sm font-medium text-muted-foreground mb-3">
                      Terminal Wealth at Age {simulationResult.yearlyProjections[simulationResult.yearlyProjections.length - 1]?.age}
                    </div>
                    <div className="overflow-y-auto max-h-[200px] space-y-1.5 pr-2 -mr-2">
                      <div className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors">
                        <span className="text-sm text-muted-foreground">90th percentile</span>
                        <span className="text-sm font-semibold" style={{color: '#10b981'}}>
                          {formatCurrency(simulationResult.percentile90TerminalWealth, true)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors">
                        <span className="text-sm text-muted-foreground">75th percentile</span>
                        <span className="text-sm font-semibold" style={{color: '#34d399'}}>
                          {formatCurrency(simulationResult.yearlyProjections[simulationResult.yearlyProjections.length - 1]?.p75 || 0, true)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2.5 px-3 rounded bg-blue-50/50 dark:bg-blue-950/20">
                        <span className="text-sm font-semibold">Median (50th)</span>
                        <span className="text-base font-bold" style={{color: '#3b82f6'}}>
                          {formatCurrency(simulationResult.medianTerminalWealth, true)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors">
                        <span className="text-sm text-muted-foreground">25th percentile</span>
                        <span className="text-sm font-semibold" style={{color: '#fbbf24'}}>
                          {formatCurrency(simulationResult.yearlyProjections[simulationResult.yearlyProjections.length - 1]?.p25 || 0, true)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors">
                        <span className="text-sm text-muted-foreground">15th percentile</span>
                        <span className="text-sm font-semibold" style={{color: '#f97316'}}>
                          {formatCurrency(simulationResult.yearlyProjections[simulationResult.yearlyProjections.length - 1]?.p15 || 0, true)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors">
                        <span className="text-sm text-muted-foreground">10th percentile</span>
                        <span className="text-sm font-semibold" style={{color: '#ea580c'}}>
                          {formatCurrency(simulationResult.percentile10TerminalWealth, true)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors">
                        <span className="text-sm text-muted-foreground">5th percentile</span>
                        <span className="text-sm font-semibold" style={{color: '#dc2626'}}>
                          {formatCurrency(simulationResult.percentile5TerminalWealth, true)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Wealth Projection Over Time</CardTitle>
                <CardDescription>
                  How your overall wealth changes year by year through savings and retirement
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WealthChart projections={simulationResult.yearlyProjections} showPercentiles={true} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Retirement Lifestyle Timeline</CardTitle>
                <CardDescription>
                  Income, spending, and portfolio value throughout your life phases
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RetirementTimeline projections={simulationResult.yearlyProjections} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Retirement Income Sources</CardTitle>
                <CardDescription>
                  Where your retirement income comes from: Social Security, 401(k), Roth IRA, HSA, and taxable accounts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RetirementIncomeChart projections={simulationResult.yearlyProjections} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                className="pb-3 cursor-pointer"
                onClick={() => setIsTableExpanded(!isTableExpanded)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Annual Cash Flow Details</CardTitle>
                    <CardDescription className="text-sm">
                      Money flows in and out of each account type (full projection)
                    </CardDescription>
                  </div>
                  <div className={`text-sm text-muted-foreground transition-transform ${isTableExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </div>
                </div>
              </CardHeader>

              {isTableExpanded && (
                <CardContent className="pt-0">
                  <div className="max-h-80 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead className="text-xs font-medium">Age</TableHead>
                          <TableHead className="text-xs font-medium">Phase</TableHead>
                          <TableHead className="text-xs font-medium text-right">External Income</TableHead>
                          <TableHead className="text-xs font-medium text-right">Spending</TableHead>
                          <TableHead className="text-xs font-medium text-right">Total Taxes</TableHead>
                          <TableHead className="text-xs font-medium text-right">Total Savings</TableHead>
                          <TableHead className="text-xs font-medium text-right">Taxable</TableHead>
                          <TableHead className="text-xs font-medium text-right">Traditional</TableHead>
                          <TableHead className="text-xs font-medium text-right">Roth</TableHead>
                          <TableHead className="text-xs font-medium text-right">HSA</TableHead>
                          <TableHead className="text-xs font-medium text-right">Portfolio</TableHead>
                          <TableHead className="text-xs font-medium text-right">Rate of Return</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRowData.map(({
                          projection, index, externalIncome, taxableFlow, traditionalFlow, rothFlow, hsaFlow, rateOfReturn, previousProjection,
                          phaseClassName, savingsClassName, taxableClassName, traditionalClassName, rothClassName, hsaClassName, returnClassName
                        }) => (
                            <TableRow key={projection.year} className={`border-border/50 ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                              <TableCell className="text-sm font-medium">{projection.age}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <span className={phaseClassName}>
                                    {projection.isRetired ? 'Retired' : 'Working'}
                                  </span>
                                  {projection.insufficientFunds && (
                                    <span className="text-red-500 text-xs" title="Insufficient funds">⚠️</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-sm font-mono">{formatCurrency(externalIncome, true)}</TableCell>
                              <TableCell className="text-right text-sm font-mono text-red-500">-{formatCurrency(projection.spending, true)}</TableCell>
                              <TableCell className="text-right text-sm font-mono text-red-500">-{formatCurrency(projection.taxes, true)}</TableCell>
                              <TableCell className={savingsClassName}>
                                {projection.savings >= 0 ? '+' : ''}{formatCurrency(projection.savings, true)}
                              </TableCell>
                              <TableCell className={taxableClassName}>
                                {taxableFlow >= 0 ? '+' : ''}{formatCurrency(taxableFlow, true)}
                              </TableCell>
                              <TableCell className={traditionalClassName}>
                                {traditionalFlow >= 0 ? '+' : ''}{formatCurrency(traditionalFlow, true)}
                              </TableCell>
                              <TableCell className={rothClassName}>
                                {rothFlow >= 0 ? '+' : ''}{formatCurrency(rothFlow, true)}
                              </TableCell>
                              <TableCell className={hsaClassName}>
                                {hsaFlow >= 0 ? '+' : ''}{formatCurrency(hsaFlow, true)}
                              </TableCell>
                              <TableCell className="text-right text-sm font-mono font-medium">{formatCurrency(projection.portfolioValue, true)}</TableCell>
                              <TableCell className={returnClassName}>
                                {previousProjection ? formatPercent(rateOfReturn) : '—'}
                              </TableCell>
                            </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="text-center py-3 border-t border-border/50 bg-muted/10 text-xs text-muted-foreground">
                      Full projection spans {simulationResult.yearlyProjections.length} years
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        ) : (
          <div className="text-center py-12 min-h-[800px] flex items-center justify-center">
            <div>
              <div className="flex items-center justify-center space-x-2 text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin" />
                <span className="text-lg">Preparing simulation...</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Adjust your retirement planning controls above to run projections
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}