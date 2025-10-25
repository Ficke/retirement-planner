"use client";

import { useCallback, useEffect } from 'react';
import { usePlan } from '@/state/usePlan';
import { useSimulationState } from '@/hooks/useSimulationState';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SimulationAnalyzer } from '@/components/SimulationAnalyzer';
import type { SocialSecurityUpdate } from '@/domain/types';
import { RefreshCw, HelpCircle } from 'lucide-react';

export function SimulationControls() {
  const { plan, updateProfile, updateSocialSecurity, runMainSimulation } = usePlan();
  const { isSimulationRunning } = useSimulationState();

  // Check if main simulation is running
  const showSpinner = isSimulationRunning();


  const handleSSChange = useCallback((updates: Partial<SocialSecurityUpdate>) => {
    // Only set enabled: true if it's not already enabled
    const finalUpdates = plan.socialSecurity.enabled
      ? updates
      : { ...updates, enabled: true };

    updateSocialSecurity(finalUpdates);
  }, [updateSocialSecurity, plan.socialSecurity.enabled]);
  const handleRetirementAgeChange = useCallback(([value]: number[]) => {
    updateProfile({ retirementAge: value });
  }, [updateProfile]);

  const handleSpendingChange = useCallback(([value]: number[]) => {
    updateProfile({ desiredSpending: value });
  }, [updateProfile]);

  const handleSalaryGrowthChange = useCallback(([value]: number[]) => {
    const rate = value / 100;
    updateProfile({ salaryGrowthRate: rate });
  }, [updateProfile]);


  // Run initial simulation on mount if no result exists
  useEffect(() => {
    const { simulationResult } = usePlan.getState();
    if (!simulationResult) {
      runMainSimulation();
    }
  }, []); // Only run on mount


  const yearsToRetirement = plan.profile.retirementAge - plan.profile.age;
  const workingYears = Math.max(0, yearsToRetirement);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retirement Planning Controls</CardTitle>
        <CardDescription>
          Adjust key assumptions and see results update in real-time
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Retirement Age: {plan.profile.retirementAge}</Label>
                <span className="text-sm text-muted-foreground">
                  {workingYears} years of work left
                </span>
              </div>
              <Slider
                value={[plan.profile.retirementAge]}
                onValueChange={handleRetirementAgeChange}
                min={45}
                max={75}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>45 (Early)</span>
                <span>65 (Traditional)</span>
                <span>75 (Late)</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Annual Spending: {formatCurrency(plan.profile.desiredSpending)}</Label>
                <span className="text-sm text-muted-foreground">
                  {formatCurrency(plan.profile.desiredSpending / 12)}/month
                </span>
              </div>
              <Slider
                value={[plan.profile.desiredSpending]}
                onValueChange={handleSpendingChange}
                min={30000}
                max={200000}
                step={5000}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>$30K</span>
                <span>$115K</span>
                <span>$200K</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Salary Growth: {(plan.profile.salaryGrowthRate * 100).toFixed(1)}%</Label>
                <span className="text-sm text-muted-foreground">
                  Real growth rate
                </span>
              </div>
              <Slider
                value={[plan.profile.salaryGrowthRate * 100]}
                onValueChange={handleSalaryGrowthChange}
                min={0}
                max={8}
                step={0.5}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span>4%</span>
                <span>8%</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>SS Claim Age: {plan.socialSecurity.claimAge}</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Age 67 = Full benefits, 62 = 75% benefits, 70 = 124% benefits</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Slider
                value={[plan.socialSecurity.claimAge]}
                onValueChange={([value]) => handleSSChange({ claimAge: value })}
                min={62}
                max={70}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>62 (Early)</span>
                <span>67 (Full)</span>
                <span>70 (Delayed)</span>
              </div>
            </div>
        </div>
      </div>


      </CardContent>
    </Card>
  );
}