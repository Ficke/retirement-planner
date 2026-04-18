"use client";

import { useMemo, useState, useEffect } from 'react';
import { usePlan } from '@/state/usePlan';
import { useSimulationState } from '@/hooks/useSimulationState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatCurrency, formatPercent } from '@/lib/format';
import { categorizeRisk, findMaxValueForRiskLevel, findMinValueForRiskLevel, RISK_THRESHOLDS } from '@/lib/risk-categories';
import { RiskLegend } from '@/components/risk-legend';
import { RefreshCw, HelpCircle, TrendingUp, DollarSign, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import type { SSAnalysisResult, SpendingAnalysisResult, RetirementAgeAnalysisResult } from '@/domain/types';

interface BestMetrics {
  riskOfRuin: number;
  age85: number;
  below1m: number;
  below500k: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findBestMetrics(results: { result: any }[]): BestMetrics {
  if (!results || results.length === 0) {
    return { riskOfRuin: 0, age85: 0, below1m: 0, below500k: 0 };
  }

  return {
    riskOfRuin: Math.min(...results.map(r => r.result.riskOfRuin)),
    age85: Math.max(...results.map(r => r.result.wealthAtAge[85]?.p50 ?? 0)),
    below1m: Math.min(...results.map(r => r.result.wealthThresholds.below1m)),
    below500k: Math.min(...results.map(r => r.result.wealthThresholds.below500k)),
  };
}

interface DetailedTableProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: any[];
  best: BestMetrics;
  keyField: string;
  keyLabel: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatKey: (value: any) => string;
}

function DetailedTable({ results, best, keyField, keyLabel, formatKey }: DetailedTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{keyLabel}</TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              Risk of Ruin
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Percent of simulations where assets hit zero</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
          <TableHead>Wealth at 85</TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              {'< $1M Risk'}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Share of simulations below $1M during retirement</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              {'< $500K Risk'}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Share of simulations below $500K during retirement</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r, index) => (
          <TableRow key={index}>
            <TableCell className="font-medium">
              {formatKey(r[keyField])}
            </TableCell>
            <TableCell className={r.result.riskOfRuin === best.riskOfRuin ? 'font-semibold text-emerald-600' : ''}>
              {(() => {
                console.log('🔍 RETIREMENT AGE DEBUG - Raw riskOfRuin:', {
                  retirementAge: r.retirementAge,
                  rawRiskOfRuin: r.result.riskOfRuin,
                  formattedRiskOfRuin: formatPercent(r.result.riskOfRuin),
                  successProbability: r.result.successProbability
                });
                return formatPercent(r.result.riskOfRuin);
              })()}
            </TableCell>
            <TableCell className={(r.result.wealthAtAge[85]?.p50 ?? 0) === best.age85 ? 'font-semibold text-emerald-600' : ''}>
              {formatCurrency(r.result.wealthAtAge[85]?.p50 ?? 0, true)}
            </TableCell>
            <TableCell className={r.result.wealthThresholds.below1m === best.below1m ? 'font-semibold text-emerald-600' : ''}>
              {formatPercent(r.result.wealthThresholds.below1m)}
            </TableCell>
            <TableCell className={r.result.wealthThresholds.below500k === best.below500k ? 'font-semibold text-emerald-600' : ''}>
              {formatPercent(r.result.wealthThresholds.below500k)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface EnhancedRetirementTableProps {
  results: Array<RetirementAgeAnalysisResult & { marginalBenefit: number }>;
  best: BestMetrics;
}

function EnhancedRetirementTable({ results, best }: EnhancedRetirementTableProps) {

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Retirement Age</TableHead>
          <TableHead>Wealth at 85</TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              Risk of Ruin
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Percent of simulations where assets hit zero</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              {'< $1M Risk'}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Share of simulations below $1M during retirement</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              {'< $500K Risk'}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Share of simulations below $500K during retirement</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r, index) => {
          const riskInfo = categorizeRisk(r.result.riskOfRuin);
          return (
            <TableRow key={index} className={riskInfo.bg}>
              <TableCell className="font-medium">
                {r.retirementAge}
              </TableCell>
              <TableCell>
                {formatCurrency(r.result.wealthAtAge[85]?.p50 ?? 0, true)}
              </TableCell>
              <TableCell className={r.result.riskOfRuin === best.riskOfRuin ? 'font-semibold text-emerald-600' : ''}>
                {(() => {
                  console.log('🔍 RETIREMENT AGE DEBUG - Raw riskOfRuin:', {
                    retirementAge: r.retirementAge,
                    rawRiskOfRuin: r.result.riskOfRuin,
                    formattedRiskOfRuin: formatPercent(r.result.riskOfRuin),
                    successProbability: r.result.successProbability,
                    terminalWealth: r.result.medianTerminalWealth
                  });
                  return formatPercent(r.result.riskOfRuin);
                })()}
              </TableCell>
              <TableCell className={r.result.wealthThresholds.below1m === best.below1m ? 'font-semibold text-emerald-600' : ''}>
                {formatPercent(r.result.wealthThresholds.below1m)}
              </TableCell>
              <TableCell className={r.result.wealthThresholds.below500k === best.below500k ? 'font-semibold text-emerald-600' : ''}>
                {formatPercent(r.result.wealthThresholds.below500k)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

interface EnhancedSpendingTableProps {
  results: Array<SpendingAnalysisResult & { marginalImpact: number }>;
  best: BestMetrics;
}

function EnhancedSpendingTable({ results, best }: EnhancedSpendingTableProps) {

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Annual Spending</TableHead>
          <TableHead>Wealth at 85</TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              Risk of Ruin
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Percent of simulations where assets hit zero</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              {'< $1M Risk'}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Share of simulations below $1M during retirement</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
          <TableHead>
            <div className="flex items-center gap-1">
              {'< $500K Risk'}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Share of simulations below $500K during retirement</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r, index) => {
          const riskInfo = categorizeRisk(r.result.riskOfRuin);
          return (
            <TableRow key={index} className={riskInfo.bg}>
              <TableCell className="font-medium">
                {formatCurrency(r.annualSpending)}
              </TableCell>
              <TableCell>
                {formatCurrency(r.result.wealthAtAge[85]?.p50 ?? 0, true)}
              </TableCell>
              <TableCell className={r.result.riskOfRuin === best.riskOfRuin ? 'font-semibold text-emerald-600' : ''}>
                {formatPercent(r.result.riskOfRuin)}
              </TableCell>
              <TableCell className={r.result.wealthThresholds.below1m === best.below1m ? 'font-semibold text-emerald-600' : ''}>
                {formatPercent(r.result.wealthThresholds.below1m)}
              </TableCell>
              <TableCell className={r.result.wealthThresholds.below500k === best.below500k ? 'font-semibold text-emerald-600' : ''}>
                {formatPercent(r.result.wealthThresholds.below500k)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SocialSecurityAnalysis() {
  const { runSSAnalysis, ssAnalysisResult, plan } = usePlan();
  const { isSimulationRunning } = useSimulationState();
  const [showDetails, setShowDetails] = useState(false);

  // Use unified spinner state from service
  const isAnalysisRunning = isSimulationRunning('social-security');
  const showSpinner = isAnalysisRunning;

  // Analysis is now triggered centrally, not per-component

  const analysis = useMemo(() => {
    if (!ssAnalysisResult || ssAnalysisResult.length === 0) return null;

    const best = findBestMetrics(ssAnalysisResult);

    const scored = ssAnalysisResult.map(r => {
      let score = 0;
      if (r.result.riskOfRuin === best.riskOfRuin) score++;
      if ((r.result.wealthAtAge[85]?.p50 ?? 0) === best.age85) score++;
      if (r.result.wealthThresholds.below1m === best.below1m) score++;
      if (r.result.wealthThresholds.below500k === best.below500k) score++;
      return { age: r.claimAge, score };
    }).sort((a, b) => b.score - a.score);

    const top = scored.filter(s => s.score === scored[0].score);
    const explanation = top.length === 1
      ? `Age ${top[0].age}`
      : `Age ${top[0].age} (also consider age ${top[1].age})`;

    return { best, explanation };
  }, [ssAnalysisResult]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Social Security Claiming Age</h3>
            <p className="text-sm text-muted-foreground">Find the optimal age to claim benefits</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 min-h-[120px]">
        {isAnalysisRunning && (
          <div className="p-4 bg-muted/30 rounded-lg text-center">
            <div className="flex items-center justify-center space-x-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Analyzing Social Security claiming strategies...</span>
            </div>
          </div>
        )}
        {analysis && !isAnalysisRunning && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
              <div>
                <div className="font-semibold text-lg text-primary">{analysis.explanation}</div>
                <div className="text-sm text-muted-foreground">Based on lowest risk and highest wealth preservation</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetails(prev => !prev)}
              >
                {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {showDetails ? 'Hide' : 'Show'} details
              </Button>
            </div>

            {showDetails && ssAnalysisResult && (
              <DetailedTable
                results={ssAnalysisResult}
                best={analysis.best}
                keyField="claimAge"
                keyLabel="Claim Age"
                formatKey={(age) => age.toString()}
              />
            )}
          </div>
        )}
        {!analysis && !isAnalysisRunning && (
          <div className="p-4 bg-muted/30 rounded-lg text-center text-muted-foreground">
            <span className="text-sm">Analysis will appear here when inputs are provided</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SpendingAnalysis() {
  const { runSpendingAnalysis, spendingAnalysisResult, plan } = usePlan();
  const { isSimulationRunning } = useSimulationState();
  const [showDetails, setShowDetails] = useState(false);

  // Use unified spinner state from service
  const isAnalysisRunning = isSimulationRunning('spending');

  // Analysis is now triggered centrally, not per-component

  const analysis = useMemo(() => {
    if (!spendingAnalysisResult || spendingAnalysisResult.length === 0) return null;

    const best = findBestMetrics(spendingAnalysisResult);

    // Calculate marginal impacts (risk increase per spending increase)
    const marginalImpacts = spendingAnalysisResult.map((result, index) => {
      const prevResult = index > 0 ? spendingAnalysisResult[index - 1] : null;
      const marginalImpact = prevResult
        ? result.result.riskOfRuin - prevResult.result.riskOfRuin
        : 0;
      return { ...result, marginalImpact };
    });

    // Use shared risk categorization for consistency across all analyses
    const getRiskLevel = (riskOfRuin: number) => categorizeRisk(riskOfRuin).category;

    // Find max spending for each risk category using shared thresholds
    const conservative = findMaxValueForRiskLevel(spendingAnalysisResult, RISK_THRESHOLDS.CONSERVATIVE);
    const moderate = findMaxValueForRiskLevel(spendingAnalysisResult, RISK_THRESHOLDS.MODERATE);
    const aggressive = findMaxValueForRiskLevel(spendingAnalysisResult, RISK_THRESHOLDS.AGGRESSIVE);

    // Current spending analysis
    const current = plan.profile.desiredSpending;
    const currentAnalysis = spendingAnalysisResult.find(r => r.annualSpending === current);

    // Generate primary recommendation based on available options
    let primaryRecommendation: string;
    let explanation: string;
    let recommendedAmount: number;

    if (moderate) {
      primaryRecommendation = `${formatCurrency(moderate.annualSpending)} (Moderate Risk)`;
      explanation = `Safe spending level (${(moderate.result.riskOfRuin * 100).toFixed(1)}% risk) - standard planning threshold`;
      recommendedAmount = moderate.annualSpending;
    } else if (conservative) {
      primaryRecommendation = `${formatCurrency(conservative.annualSpending)} (Conservative)`;
      explanation = `Very safe spending level (${(conservative.result.riskOfRuin * 100).toFixed(1)}% risk)`;
      recommendedAmount = conservative.annualSpending;
    } else if (aggressive) {
      primaryRecommendation = `${formatCurrency(aggressive.annualSpending)} (Aggressive)`;
      explanation = `Higher risk spending (${(aggressive.result.riskOfRuin * 100).toFixed(1)}% risk) - consider backup plans`;
      recommendedAmount = aggressive.annualSpending;
    } else {
      // All spending levels are high risk
      const safestSpending = spendingAnalysisResult.reduce((prev, curr) =>
        curr.result.riskOfRuin < prev.result.riskOfRuin ? curr : prev
      );
      primaryRecommendation = `${formatCurrency(safestSpending.annualSpending)} (High Risk)`;
      explanation = `All spending levels show elevated risk - consider reducing expenses`;
      recommendedAmount = safestSpending.annualSpending;
    }

    // Current vs optimal insight
    const difference = recommendedAmount - current;
    let currentInsight = '';
    if (Math.abs(difference) > 2500) {
      if (difference > 0) {
        currentInsight = `💡 You could safely spend ${formatCurrency(difference)} more annually`;
      } else {
        currentInsight = `⚠️ Consider reducing spending by ${formatCurrency(-difference)} for better outcomes`;
      }
    } else {
      currentInsight = `✅ Your current spending (${formatCurrency(current)}) is well-positioned`;
    }

    // Find diminishing returns point
    let diminishingInsight = '';
    const highImpactSpending = marginalImpacts.find(r => r.marginalImpact > 0.03); // 3% risk jump
    if (highImpactSpending) {
      diminishingInsight = `📊 Risk accelerates significantly beyond ${formatCurrency(highImpactSpending.annualSpending)} annually`;
    }

    return {
      best,
      primaryRecommendation,
      explanation,
      currentInsight,
      diminishingInsight,
      conservative: conservative ? `${formatCurrency(conservative.annualSpending)} (${(conservative.result.riskOfRuin * 100).toFixed(1)}% risk)` : null,
      moderate: moderate ? `${formatCurrency(moderate.annualSpending)} (${(moderate.result.riskOfRuin * 100).toFixed(1)}% risk)` : null,
      aggressive: aggressive ? `${formatCurrency(aggressive.annualSpending)} (${(aggressive.result.riskOfRuin * 100).toFixed(1)}% risk)` : null,
      currentRiskLevel: currentAnalysis ? getRiskLevel(currentAnalysis.result.riskOfRuin) : null,
      marginalImpacts
    };
  }, [spendingAnalysisResult, plan.profile.desiredSpending]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Annual Spending Analysis</h3>
            <p className="text-sm text-muted-foreground">Determine your optimal spending capacity using risk-based evaluation</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 min-h-[160px]">
        {isAnalysisRunning && (
          <div className="p-4 bg-muted/30 rounded-lg text-center">
            <div className="flex items-center justify-center space-x-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Analyzing spending capacity scenarios...</span>
            </div>
          </div>
        )}
        {analysis && !isAnalysisRunning && (
          <div className="space-y-4">
            <div className="p-4 bg-muted/30 rounded-lg space-y-3">
              <div>
                <div className="font-semibold text-lg text-primary">{analysis.primaryRecommendation}</div>
                <div className="text-sm text-muted-foreground">{analysis.explanation}</div>
                {analysis.currentInsight && (
                <div className="text-xs text-muted-foreground mt-2">{analysis.currentInsight}</div>
              )}
              {analysis.diminishingInsight && (
                <div className="text-xs text-muted-foreground mt-1 italic">{analysis.diminishingInsight}</div>
              )}
            </div>

            {(analysis.conservative || analysis.moderate || analysis.aggressive) && (
              <div className="border-t pt-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground mb-2">Spending Capacity by Risk Tolerance:</div>
                {analysis.conservative && (
                  <div className="text-xs text-emerald-600">🛡️ Conservative: {analysis.conservative}</div>
                )}
                {analysis.moderate && (
                  <div className="text-xs text-blue-600">⚖️ Moderate: {analysis.moderate}</div>
                )}
                {analysis.aggressive && (
                  <div className="text-xs text-amber-600">🚀 Aggressive: {analysis.aggressive}</div>
                )}
                {analysis.currentRiskLevel && (
                  <div className="text-xs text-slate-600 mt-2 pt-2 border-t">
                    Current spending risk level: <strong>{analysis.currentRiskLevel}</strong>
                  </div>
                )}
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(prev => !prev)}
              className="mt-2"
            >
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showDetails ? 'Hide' : 'Show'} details
            </Button>
            </div>

            {showDetails && spendingAnalysisResult && (
              <>
                <RiskLegend />
                <EnhancedSpendingTable
                  results={analysis.marginalImpacts}
                  best={analysis.best}
                />
              </>
            )}
          </div>
        )}
        {!analysis && !isAnalysisRunning && (
          <div className="p-4 bg-muted/30 rounded-lg text-center text-muted-foreground">
            <span className="text-sm">Analysis will appear here when inputs are provided</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RetirementAgeAnalysis() {
  const { runRetirementAgeAnalysis, retirementAgeAnalysisResult, plan } = usePlan();
  const { isSimulationRunning } = useSimulationState();
  const [showDetails, setShowDetails] = useState(false);

  // Use unified spinner state from service
  const isAnalysisRunning = isSimulationRunning('retirement-age');

  // Analysis is now triggered centrally, not per-component

  const analysis = useMemo(() => {
    if (!retirementAgeAnalysisResult || retirementAgeAnalysisResult.length === 0) return null;

    const best = findBestMetrics(retirementAgeAnalysisResult);

    // Calculate marginal benefits (reduction in risk per additional year)
    const marginalBenefits = retirementAgeAnalysisResult.map((result, index) => {
      const prevResult = index > 0 ? retirementAgeAnalysisResult[index - 1] : null;
      const marginalBenefit = prevResult
        ? prevResult.result.riskOfRuin - result.result.riskOfRuin
        : 0;
      return { ...result, marginalBenefit };
    });

    // Find knee of the curve (diminishing returns point)
    let kneeAge = null;
    let maxDropIndex = 1;
    let maxDrop = 0;
    for (let i = 2; i < marginalBenefits.length; i++) {
      const currentBenefit = marginalBenefits[i].marginalBenefit;
      const previousBenefit = marginalBenefits[i-1].marginalBenefit;
      const drop = previousBenefit - currentBenefit;
      if (drop > maxDrop) {
        maxDrop = drop;
        maxDropIndex = i;
      }
    }

    // Also find where marginal benefit becomes very small (< 1%)
    const lowBenefitResult = marginalBenefits.find(r => r.marginalBenefit < 0.01 && r.marginalBenefit > 0);
    if (lowBenefitResult && marginalBenefits[maxDropIndex]) {
      kneeAge = Math.min(marginalBenefits[maxDropIndex].retirementAge, lowBenefitResult.retirementAge);
    } else if (marginalBenefits[maxDropIndex]) {
      kneeAge = marginalBenefits[maxDropIndex].retirementAge;
    }

    // Use shared risk categorization for consistency across all analyses
    // For retirement age, we want the EARLIEST age that meets each risk threshold
    const conservative = findMinValueForRiskLevel(retirementAgeAnalysisResult, RISK_THRESHOLDS.CONSERVATIVE);
    const moderate = findMinValueForRiskLevel(retirementAgeAnalysisResult, RISK_THRESHOLDS.MODERATE);
    const aggressive = findMinValueForRiskLevel(retirementAgeAnalysisResult, RISK_THRESHOLDS.AGGRESSIVE);

    // Generate insights
    let primaryRecommendation: string;
    let explanation: string;
    let recommendedAge: number;

    if (moderate) {
      primaryRecommendation = `Age ${moderate.retirementAge} (Moderate)`;
      explanation = `Good safety margin (${(moderate.result.riskOfRuin * 100).toFixed(1)}% risk) - standard planning threshold`;
      recommendedAge = moderate.retirementAge;
    } else if (conservative) {
      primaryRecommendation = `Age ${conservative.retirementAge} (Conservative)`;
      explanation = `Excellent safety margin (${(conservative.result.riskOfRuin * 100).toFixed(1)}% risk)`;
      recommendedAge = conservative.retirementAge;
    } else if (aggressive) {
      primaryRecommendation = `Age ${aggressive.retirementAge} (Aggressive)`;
      explanation = `Higher risk (${(aggressive.result.riskOfRuin * 100).toFixed(1)}% risk) - consider backup plans`;
      recommendedAge = aggressive.retirementAge;
    } else {
      // All ages show high risk
      const safestAge = retirementAgeAnalysisResult.reduce((prev, current) =>
        current.result.riskOfRuin < prev.result.riskOfRuin ? current : prev
      );
      primaryRecommendation = `Age ${safestAge.retirementAge} (High Risk)`;
      explanation = `All scenarios show elevated risk - consider working longer or reducing spending`;
      recommendedAge = safestAge.retirementAge;
    }

    // Add knee of curve insight
    let kneeInsight = '';
    if (kneeAge && kneeAge !== recommendedAge) {
      const kneeResult = marginalBenefits.find(r => r.retirementAge === kneeAge);
      if (kneeResult) {
        kneeInsight = `📊 Diminishing returns beyond age ${kneeAge} (${(kneeResult.marginalBenefit * 100).toFixed(1)}% risk reduction per year)`;
      }
    }

    return {
      best,
      primaryRecommendation,
      explanation,
      kneeInsight,
      conservative: conservative ? `Age ${conservative.retirementAge} (${(conservative.result.riskOfRuin * 100).toFixed(1)}% risk)` : null,
      moderate: moderate ? `Age ${moderate.retirementAge} (${(moderate.result.riskOfRuin * 100).toFixed(1)}% risk)` : null,
      aggressive: aggressive ? `Age ${aggressive.retirementAge} (${(aggressive.result.riskOfRuin * 100).toFixed(1)}% risk)` : null,
      marginalBenefits
    };
  }, [retirementAgeAnalysisResult]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Retirement Age Analysis</h3>
            <p className="text-sm text-muted-foreground">Find your optimal retirement age using financial planning best practices</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 min-h-[160px]">
        {isAnalysisRunning && (
          <div className="p-4 bg-muted/30 rounded-lg text-center">
            <div className="flex items-center justify-center space-x-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Analyzing retirement age scenarios...</span>
            </div>
          </div>
        )}
        {analysis && !isAnalysisRunning && (
          <div className="space-y-4">
            <div className="p-4 bg-muted/30 rounded-lg space-y-3">
              <div>
                <div className="font-semibold text-lg text-primary">{analysis.primaryRecommendation}</div>
                <div className="text-sm text-muted-foreground">{analysis.explanation}</div>
                {analysis.kneeInsight && (
                  <div className="text-xs text-muted-foreground mt-2 italic">{analysis.kneeInsight}</div>
                )}
              </div>

              {(analysis.conservative || analysis.moderate || analysis.aggressive) && (
                <div className="border-t pt-3 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Risk Tolerance Options:</div>
                {analysis.conservative && (
                  <div className="text-xs text-emerald-600">🛡️ Conservative: {analysis.conservative}</div>
                )}
                {analysis.moderate && (
                  <div className="text-xs text-blue-600">⚖️ Moderate: {analysis.moderate}</div>
                )}
                {analysis.aggressive && (
                  <div className="text-xs text-amber-600">🚀 Aggressive: {analysis.aggressive}</div>
                )}
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(prev => !prev)}
              className="mt-2"
            >
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showDetails ? 'Hide' : 'Show'} details
            </Button>
            </div>

            {showDetails && retirementAgeAnalysisResult && (
              <>
                <RiskLegend />
                <EnhancedRetirementTable
                  results={analysis.marginalBenefits}
                  best={analysis.best}
                />
              </>
            )}
          </div>
        )}
        {!analysis && !isAnalysisRunning && (
          <div className="p-4 bg-muted/30 rounded-lg text-center text-muted-foreground">
            <span className="text-sm">Analysis will appear here when inputs are provided</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function SimulationAnalyzer() {
  const [isExpanded, setIsExpanded] = useState(true);
  const { runSSAnalysis, runSpendingAnalysis, runRetirementAgeAnalysis, plan } = usePlan();

  // Get the current analysis results for display only
  const { ssAnalysisResult, spendingAnalysisResult, retirementAgeAnalysisResult } = usePlan();

  // Only run analyses on initial mount if results are missing
  useEffect(() => {
    if (isExpanded) {
      if (!ssAnalysisResult) runSSAnalysis();
      if (!spendingAnalysisResult) runSpendingAnalysis();
      if (!retirementAgeAnalysisResult) runRetirementAgeAnalysis();
    }
  }, [isExpanded]); // Only depend on isExpanded - state management now handles scheduling

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl font-semibold">Scenario Analysis</CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5 cursor-help">
                      lower fidelity
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Each scenario runs 1,000 paths vs. 5,000 for the main simulation — results are directional, not directly comparable.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Analyze different strategies to optimize your retirement plan
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(prev => !prev)}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <Tabs defaultValue="social-security" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="social-security">Social Security</TabsTrigger>
              <TabsTrigger value="spending">Spending</TabsTrigger>
              <TabsTrigger value="retirement-age">Retirement Age</TabsTrigger>
            </TabsList>

            <TabsContent value="social-security">
              <SocialSecurityAnalysis />
            </TabsContent>

            <TabsContent value="spending">
              <SpendingAnalysis />
            </TabsContent>

            <TabsContent value="retirement-age">
              <RetirementAgeAnalysis />
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}