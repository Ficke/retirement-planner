"use client";

import { useMemo, useState } from 'react';
import { usePlan } from '@/state/usePlan';
import { useSimulationState } from '@/hooks/useSimulationState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { categorizeRisk } from '@/lib/risk-categories';
import { RiskLegend } from '@/components/risk-legend';
import { RefreshCw, HelpCircle } from 'lucide-react';

export function SocialSecurityAnalyzer() {
  const { runSSAnalysis, ssAnalysisResult } = usePlan();
  const { isSimulationRunning } = useSimulationState();
  const isAnalysisRunning = isSimulationRunning('social-security');
  const [showDetails, setShowDetails] = useState(false);

  const analysis = useMemo(() => {
    if (!ssAnalysisResult || ssAnalysisResult.length === 0) return null;
    const best = {
      riskOfRuin: Math.min(...ssAnalysisResult.map(r => r.result.riskOfRuin)),
      age65: Math.max(
        ...ssAnalysisResult.map(r => r.result.wealthAtAge[65]?.p50 ?? 0)
      ),
      age75: Math.max(
        ...ssAnalysisResult.map(r => r.result.wealthAtAge[75]?.p50 ?? 0)
      ),
      age85: Math.max(
        ...ssAnalysisResult.map(r => r.result.wealthAtAge[85]?.p50 ?? 0)
      ),
      age95: Math.max(
        ...ssAnalysisResult.map(r => r.result.wealthAtAge[95]?.p50 ?? 0)
      ),
      below1m: Math.min(
        ...ssAnalysisResult.map(r => r.result.wealthThresholds.below1m)
      ),
      below500k: Math.min(
        ...ssAnalysisResult.map(r => r.result.wealthThresholds.below500k)
      ),
    };

    const descriptions = {
      riskOfRuin: 'the lowest risk of ruin',
      age85: 'the highest median wealth at age 85',
      below1m: 'the lowest chance of falling below $1M in retirement',
      below500k: 'the lowest chance of falling below $500k in retirement',
    } as const;

    // Simple, concise recommendation: choose the age that matches the most
    // favorable metrics (lowest ruin/thresholds, strongest age-85 wealth).
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
      ? `Recommended: age ${top[0].age}.`
      : `Recommended: age ${top[0].age}. Also reasonable: age ${top[1].age}.`;

    return { best, explanation };
  }, [ssAnalysisResult]);

  const table = useMemo(() => {
    if (!analysis || !ssAnalysisResult || ssAnalysisResult.length === 0)
      return null;

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Claim Age</TableHead>
            <TableHead>Wealth at 85</TableHead>
            <TableHead>
              <div className="flex items-center space-x-1">
                <span>Risk of Ruin</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Percent of simulations where assets hit zero.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </TableHead>
            <TableHead>
              <div className="flex items-center space-x-1">
                <span>{'< $1M Risk'}</span>
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
              <div className="flex items-center space-x-1">
                <span>{'< $500K Risk'}</span>
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
          {ssAnalysisResult.map(r => {
            const riskInfo = categorizeRisk(r.result.riskOfRuin);
            return (
              <TableRow key={r.claimAge} className={riskInfo.bg}>
                <TableCell>{r.claimAge}</TableCell>
                <TableCell
                  className={(r.result.wealthAtAge[85]?.p50 ?? 0) === analysis.best.age85 ? 'font-bold text-primary' : ''}
                >
                  {formatCurrency(r.result.wealthAtAge[85]?.p50 ?? 0, true)}
                </TableCell>
                <TableCell
                  className={
                    r.result.riskOfRuin === analysis.best.riskOfRuin
                      ? 'font-bold text-primary'
                      : ''
                  }
                >
                  {formatPercent(r.result.riskOfRuin)}
                </TableCell>
                <TableCell
                  className={
                    r.result.wealthThresholds.below1m === analysis.best.below1m
                      ? 'font-bold text-primary'
                      : ''
                  }
                >
                  {formatPercent(r.result.wealthThresholds.below1m)}
                </TableCell>
                <TableCell
                  className={
                    r.result.wealthThresholds.below500k === analysis.best.below500k
                      ? 'font-bold text-primary'
                      : ''
                  }
                >
                  {formatPercent(r.result.wealthThresholds.below500k)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }, [analysis, ssAnalysisResult]);

  return (
    <div className="space-y-4">
      <Button onClick={() => runSSAnalysis()} disabled={isAnalysisRunning}>
        {isAnalysisRunning && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
        Analyze Social Security Claiming Strategies
      </Button>
      {analysis && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Claim Age Recommendation</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(prev => !prev)}
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </Button>
          </CardHeader>
          <CardContent>
            <p>{analysis.explanation}</p>
            {showDetails && (
              <div className="mt-4">
                <RiskLegend />
                {table}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
