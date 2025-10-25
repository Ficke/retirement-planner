/**
 * React hook for consuming simulation state.
 * Now reads from usePlan store - single source of truth.
 */

import { usePlan } from '@/state/usePlan';

export type SimulationType = 'main' | 'social-security' | 'spending' | 'retirement-age';

export function useSimulationState() {
  const isSimulatingMain = usePlan(state => state.isSimulatingMain);
  const isSimulatingSS = usePlan(state => state.isSimulatingSS);
  const isSimulatingSpending = usePlan(state => state.isSimulatingSpending);
  const isSimulatingRetirementAge = usePlan(state => state.isSimulatingRetirementAge);

  const isSimulationRunning = (type?: SimulationType): boolean => {
    if (!type) {
      return isSimulatingMain || isSimulatingSS || isSimulatingSpending || isSimulatingRetirementAge;
    }

    switch (type) {
      case 'main':
        return isSimulatingMain;
      case 'social-security':
        return isSimulatingSS;
      case 'spending':
        return isSimulatingSpending;
      case 'retirement-age':
        return isSimulatingRetirementAge;
      default:
        return false;
    }
  };

  return {
    isRunning: isSimulatingMain || isSimulatingSS || isSimulatingSpending || isSimulatingRetirementAge,
    isSimulationRunning
  };
}