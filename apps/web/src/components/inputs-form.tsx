"use client";

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { usePlan } from '@/state/usePlan';
import { userProfileSchema } from '@/domain/schemas';
import { calculateTax } from '@/engine/tax';
import { formatCurrency, formatPercent, parseCurrency } from '@/lib/format';
import type { UserProfile, FilingStatus, State } from '@/domain/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function InputsForm() {
  const { plan, updateProfile, simulationResult } = usePlan();
  const [isBreakdownExpanded, setIsBreakdownExpanded] = useState(false);
  
  const {
    setValue,
    watch,
    formState: { errors },
  } = useForm<UserProfile>({
    resolver: zodResolver(userProfileSchema),
    defaultValues: plan.profile,
    mode: 'onChange',
  });

  const watchedValues = watch();
  
  // Auto-save on any field change
  useEffect(() => {
    const subscription = watch((data) => {
      if (data && Object.keys(data).length > 0) {
        updateProfile(data as UserProfile);
      }
    });
    
    return () => subscription.unsubscribe();
  }, [watch, updateProfile]);

  const calculateTaxEstimates = () => {
    const grossSalary = watchedValues.currentSalary || 0;

    // Use simulation results as source of truth if available
    if (simulationResult && simulationResult.yearlyProjections.length > 0) {
      const firstYear = simulationResult.yearlyProjections[0];
      const afterTaxIncome = firstYear.income - firstYear.taxes;
      const totalSavings = firstYear.savings;
      const savingsRate = grossSalary > 0 ? totalSavings / grossSalary : 0;

      return {
        taxes: firstYear.taxes,
        afterTaxIncome: afterTaxIncome - (watchedValues.desiredSpending || 0),
        savingsAmount: totalSavings,
        savingsRate,
        k401Contribution: firstYear.depositTraditional,
        hsaContribution: firstYear.depositHSA,
        backdoorRothContribution: firstYear.depositRoth,
        actualSavings: firstYear.depositTaxable,
      };
    }

    // Fallback to simplified calculation if no simulation results
    const taxResult = calculateTax(
      grossSalary,
      0,
      watchedValues.age || 35,
      watchedValues.filingStatus || 'Single',
      watchedValues.state || 'CA'
    );

    const afterTaxIncome = grossSalary - taxResult.totalTax;
    const availableForSpending = afterTaxIncome - (watchedValues.desiredSpending || 0);

    return {
      taxes: taxResult.totalTax,
      afterTaxIncome: availableForSpending,
      savingsAmount: 0,
      savingsRate: 0,
      k401Contribution: taxResult.k401Contribution,
      hsaContribution: taxResult.hsaContribution || 0,
      backdoorRothContribution: 0,
      actualSavings: 0,
    };
  };
  
  const estimates = calculateTaxEstimates();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal Information</CardTitle>
        <CardDescription>
          Enter your basic information and retirement goals
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="age">Current Age</Label>
              <Input
                id="age"
                type="number"
                defaultValue={watchedValues.age || ''}
                onBlur={(e) => setValue('age', Number(e.target.value))}
              />
              {errors.age && (
                <p className="text-sm text-red-500">{errors.age.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Select
                value={watch('state')}
                onValueChange={(value) => setValue('state', value as State)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CA">California</SelectItem>
                  <SelectItem value="TX">Texas</SelectItem>
                  <SelectItem value="FL">Florida</SelectItem>
                  <SelectItem value="NY">New York</SelectItem>
                  <SelectItem value="WA">Washington</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.state && (
                <p className="text-sm text-red-500">{errors.state.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="filingStatus">Filing Status</Label>
              <Select
                value={watch('filingStatus')}
                onValueChange={(value) => setValue('filingStatus', value as FilingStatus)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select filing status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Single">Single</SelectItem>
                  <SelectItem value="MarriedFilingJointly">Married Filing Jointly</SelectItem>
                  <SelectItem value="MarriedFilingSeparately">Married Filing Separately</SelectItem>
                  <SelectItem value="HeadOfHousehold">Head of Household</SelectItem>
                </SelectContent>
              </Select>
              {errors.filingStatus && (
                <p className="text-sm text-red-500">{errors.filingStatus.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="currentSalary">Current Salary</Label>
              <Input
                id="currentSalary"
                type="text"
                defaultValue={formatCurrency(watchedValues.currentSalary || 0)}
                onBlur={(e) => setValue('currentSalary', parseCurrency(e.target.value))}
                placeholder="$100,000"
              />
              {errors.currentSalary && (
                <p className="text-sm text-red-500">{errors.currentSalary.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="lifeExpectancy">Life Expectancy</Label>
              <Input
                id="lifeExpectancy"
                type="number"
                defaultValue={watchedValues.lifeExpectancy || ''}
                onBlur={(e) => setValue('lifeExpectancy', Number(e.target.value))}
                placeholder="95"
              />
              {errors.lifeExpectancy && (
                <p className="text-sm text-red-500">{errors.lifeExpectancy.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="asOfDate">As-of Date</Label>
              <Input
                id="asOfDate"
                type="date"
                value={watchedValues.asOfDate || ''}
                onChange={(e) => setValue('asOfDate', e.target.value)}
              />
              {errors.asOfDate && (
                <p className="text-sm text-red-500">{errors.asOfDate.message}</p>
              )}
            </div>
          </div>
          
          <div className="mt-6">
            <div
              className="cursor-pointer p-4 bg-muted/50 rounded-lg"
              onClick={() => setIsBreakdownExpanded(!isBreakdownExpanded)}
            >
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Tax & Savings Breakdown</h4>
                <div className={`text-sm text-muted-foreground transition-transform ${isBreakdownExpanded ? 'rotate-180' : ''}`}>
                  ▼
                </div>
              </div>
              <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                <span>Savings Rate: {formatPercent(estimates.savingsRate)}</span>
              </div>
            </div>

            {isBreakdownExpanded && (
              <div className="mt-3 p-4 bg-muted/30 rounded-lg space-y-4">
                {/* Income & Tax Flow */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Gross Salary:</span>
                    <span className="font-medium">{formatCurrency(watchedValues.currentSalary || 0)}</span>
                  </div>

                  {/* Tax Details */}
                  <div className="ml-4 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground text-xs">Taxable Income:</span>
                      <span className="font-medium text-xs">{formatCurrency((watchedValues.currentSalary || 0) - estimates.k401Contribution)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">− Total Taxes (Fed + State + FICA):</span>
                      <span className="font-medium text-red-600">−{formatCurrency(estimates.taxes)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span className="ml-4">Effective Tax Rate (vs Gross):</span>
                      <span>{formatPercent(estimates.taxes / (watchedValues.currentSalary || 1))}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span className="ml-4">Effective Tax Rate (vs Taxable):</span>
                      <span>{formatPercent(estimates.taxes / Math.max((watchedValues.currentSalary || 0) - estimates.k401Contribution, 1))}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center border-t pt-2 font-medium">
                    <span className="text-muted-foreground">Take-Home Pay:</span>
                    <span>{formatCurrency((watchedValues.currentSalary || 0) - estimates.taxes)}</span>
                  </div>
                </div>

                {/* Spending */}
                <div className="space-y-2 text-sm border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">− Desired Spending:</span>
                    <span className="font-medium text-red-600">−{formatCurrency(watchedValues.desiredSpending || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center border-t pt-2 font-medium">
                    <span className="text-muted-foreground">Available for Savings:</span>
                    <span className="font-medium">{formatCurrency(estimates.afterTaxIncome - (watchedValues.desiredSpending || 0))}</span>
                  </div>
                </div>

                {/* Savings Breakdown */}
                <div className="space-y-2 text-sm border-t pt-4">
                  <h5 className="font-medium text-sm mb-2">Total Savings: {formatCurrency(estimates.savingsAmount)}</h5>
                  <div className="space-y-1 ml-4">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">• 401(k) Contribution:</span>
                      <span className="font-medium text-blue-600">{formatCurrency(estimates.k401Contribution)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">• HSA Contribution:</span>
                      <span className="font-medium text-teal-600">{formatCurrency(estimates.hsaContribution)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">• Backdoor Roth IRA:</span>
                      <span className="font-medium text-purple-600">{formatCurrency(estimates.backdoorRothContribution)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">• Additional Savings:</span>
                      <span className={`font-medium ${estimates.actualSavings >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCurrency(estimates.actualSavings)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="border-t pt-3 space-y-2">
                  <div className="flex justify-between items-center font-semibold text-base">
                    <span className="text-foreground">Total Savings Rate:</span>
                    <span className={`font-bold ${estimates.savingsRate >= 0.1 ? 'text-green-600' : estimates.savingsRate >= 0.05 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {formatPercent(estimates.savingsRate)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}