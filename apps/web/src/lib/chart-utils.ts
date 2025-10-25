import { useMemo } from 'react';
import type { YearlyProjection } from '@/domain/types';

export interface WealthChartDataPoint {
  age: number;
  year: number;
  wealth: number;
  p5: number;
  p10: number;
  p15: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  outerBandLower: number;
  outerBandUpper: number;
  innerBandLower: number;
  innerBandUpper: number;
  phase: 'Working' | 'Retirement';
  isRetired: boolean;
}

export interface PercentileBand {
  dataKey: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  opacity: number;
  name: string;
}

/**
 * Transform yearly projections into chart-ready data with proper scaling
 */
export function useWealthChartData(projections: YearlyProjection[]): WealthChartDataPoint[] {
  return useMemo(() => {
    return projections.map((proj) => ({
      age: proj.age,
      year: proj.year,
      wealth: proj.portfolioValue,
      p5: proj.p5,
      p10: proj.p10,
      p15: proj.p15,
      p25: proj.p25,
      p50: proj.p50,
      p75: proj.p75,
      p90: proj.p90,
      outerBandLower: proj.p10,
      outerBandUpper: proj.p90,
      innerBandLower: proj.p25,
      innerBandUpper: proj.p75,
      phase: proj.isRetired ? 'Retirement' : 'Working',
      isRetired: proj.isRetired,
    }));
  }, [projections]);
}

/**
 * Generate percentile band configuration for wealth charts
 * Follows modern fintech design patterns with proper visual hierarchy
 */
export function usePercentileBands(): {
  confidenceBands: PercentileBand[];
  percentileLines: PercentileBand[];
  medianLine: PercentileBand;
} {
  return useMemo(() => ({
    confidenceBands: [
      {
        dataKey: 'confidence', 
        fill: 'hsl(var(--wealth-confidence-inner) / 0.15)',
        opacity: 1,
        name: '25th-75th percentile range',
      },
    ],
    percentileLines: [
      {
        dataKey: 'p75',
        fill: 'none',
        stroke: 'hsl(var(--wealth-confidence-inner) / 0.7)',
        strokeWidth: 1.5,
        strokeDasharray: '3 2',
        opacity: 1,
        name: 'Good case (75th)',
      },
      {
        dataKey: 'p25',
        fill: 'none', 
        stroke: 'hsl(var(--wealth-confidence-inner) / 0.7)',
        strokeWidth: 1.5,
        strokeDasharray: '3 2',
        opacity: 1,
        name: 'Conservative case (25th)',
      },
    ],
    medianLine: {
      dataKey: 'p50',
      fill: 'none',
      stroke: 'hsl(var(--wealth-median))',
      strokeWidth: 3,
      opacity: 1,
      name: 'Median projection',
    },
  }), []);
}


/**
 * Calculate dynamic Y-axis domain based on data range
 * Ensures proper chart scaling without cutting off data
 */
export function useChartDomain(data: WealthChartDataPoint[]): [number, number] {
  return useMemo(() => {
    if (data.length === 0) return [0, 1000000];
    
    const allValues = data.flatMap(d => [d.p25, d.p75]);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    
    // Add 10% padding to top and bottom
    const padding = (max - min) * 0.1;
    const domainMin = Math.max(0, min - padding); // Never go below 0
    const domainMax = max + padding;
    
    return [domainMin, domainMax];
  }, [data]);
}