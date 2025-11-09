"use client";

import { useCallback } from 'react';
import { usePlan } from '@/state/usePlan';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';

export function AssumptionsPanel() {
  const { plan, updateAssumptions, useServerSideCalculations, setUseServerSideCalculations } = usePlan();
  const { assumptions } = plan;

  // Use a stable reference to prevent unnecessary re-renders
  const simulationModel = assumptions.simulationModel ?? 'historical';


  const handleRebalanceChange = useCallback((checked: boolean) => {
    updateAssumptions({ rebalanceAnnually: checked });
  }, [updateAssumptions]);

  const handleRealDisplayChange = useCallback((checked: boolean) => {
    updateAssumptions({ realDollarDisplay: checked });
  }, [updateAssumptions]);

  const handleServerSideChange = useCallback((checked: boolean) => {
    setUseServerSideCalculations(checked);
  }, [setUseServerSideCalculations]);

  const handleLongevityChange = useCallback(([value]: number[]) => {
    updateAssumptions({ longevityOverride: value });
  }, [updateAssumptions]);

  const handleSimulationModelChange = useCallback((model: 'historical' | 'parametric') => {
    // Prevent unnecessary updates if the value hasn't changed
    if (simulationModel !== model) {
      updateAssumptions({ simulationModel: model });
    }
  }, [updateAssumptions, simulationModel]);

  const handleHistoricalModelSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.target.checked) {
      handleSimulationModelChange('historical');
    }
  }, [handleSimulationModelChange]);

  const handleParametricModelSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.target.checked) {
      handleSimulationModelChange('parametric');
    }
  }, [handleSimulationModelChange]);

  const handleSeedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
      updateAssumptions({ randomSeed: undefined });
    } else {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 0) {
        updateAssumptions({ randomSeed: numValue });
      }
    }
  }, [updateAssumptions]);

  const handleBackdoorRothChange = useCallback((checked: boolean) => {
    updateAssumptions({ useBackdoorRoth: checked });
  }, [updateAssumptions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projection Settings</CardTitle>
        <CardDescription>
          Configure return assumptions and contribution strategies
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Label htmlFor="backdoorRoth">Backdoor Roth Contributions</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Enable backdoor Roth IRA contributions from discretionary income (after HSA and 401k)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Switch
            id="backdoorRoth"
            checked={assumptions.useBackdoorRoth ?? true}
            onCheckedChange={handleBackdoorRothChange}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Label htmlFor="rebalance">Annual Rebalancing</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Rebalance portfolio to target weights each year</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Switch
            id="rebalance"
            checked={assumptions.rebalanceAnnually}
            onCheckedChange={handleRebalanceChange}
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Label htmlFor="realDisplay">Dollar Display Mode</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Real = today&apos;s purchasing power (inflation-adjusted), Nominal = future dollar amounts</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="real-dollars"
                name="dollar-mode"
                checked={assumptions.realDollarDisplay}
                onChange={() => handleRealDisplayChange(true)}
                className="w-4 h-4"
              />
              <Label htmlFor="real-dollars" className="text-sm">Real Dollars</Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="nominal-dollars"
                name="dollar-mode"
                checked={!assumptions.realDollarDisplay}
                onChange={() => handleRealDisplayChange(false)}
                className="w-4 h-4"
              />
              <Label htmlFor="nominal-dollars" className="text-sm">Nominal Dollars</Label>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Label htmlFor="simulationModel">Simulation Model</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Historical Bootstrap uses actual historical market data, Parametric uses normal distribution assumptions</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="historical-model"
                name="simulation-model"
                checked={simulationModel === 'historical'}
                onChange={handleHistoricalModelSelect}
                className="w-4 h-4"
              />
              <Label htmlFor="historical-model" className="text-sm cursor-pointer">Historical Bootstrap</Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="parametric-model"
                name="simulation-model"
                checked={simulationModel === 'parametric'}
                onChange={handleParametricModelSelect}
                className="w-4 h-4"
              />
              <Label htmlFor="parametric-model" className="text-sm cursor-pointer">Parametric (Normal Distribution)</Label>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Label htmlFor="randomSeed">Random Seed (Optional)</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Set a specific random seed to get reproducible simulation results</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Input
            id="randomSeed"
            type="number"
            min="0"
            step="1"
            placeholder="Auto-generated"
            value={assumptions.randomSeed ?? ''}
            onChange={handleSeedChange}
            className="max-w-xs"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Label htmlFor="serverSide">Server-side Calculations</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Use high-performance Rust server for faster, consistent simulations. Disable for privacy (calculations run locally on your device).</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Switch
            id="serverSide"
            checked={useServerSideCalculations}
            onCheckedChange={handleServerSideChange}
          />
        </div>

        {assumptions.longevityOverride && (
          <details className="group">
            <summary className="cursor-pointer p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Longevity Override</h4>
                <div className="text-sm text-muted-foreground group-open:rotate-180 transition-transform">
                  ▼
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Planning to age {assumptions.longevityOverride}
              </p>
            </summary>
            <div className="mt-3 space-y-4">
              <div className="space-y-2">
                <Label>Planning Horizon: {assumptions.longevityOverride} years</Label>
                <Slider
                  value={[assumptions.longevityOverride]}
                  onValueChange={handleLongevityChange}
                  min={65}
                  max={110}
                  step={1}
                  className="w-full"
                />
              </div>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}