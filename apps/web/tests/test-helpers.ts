/**
 * Test helpers for creating valid test data
 */
import type { Account, ProjectionSettings } from '@/domain/types';

/**
 * Create a valid Account object for testing
 */
export function createTestAccount(partial: Partial<Account> & { type: Account['type']; balance: number }): Account {
  return {
    id: partial.id || `test-${partial.type.toLowerCase()}-${Date.now()}`,
    name: partial.name || `Test ${partial.type} Account`,
    institution: partial.institution || 'Test Brokerage',
    type: partial.type,
    balance: partial.balance,
    assetWeights: partial.assetWeights || { stocks: 0.6, bonds: 0.4 },
  };
}

/**
 * Create valid ProjectionSettings for testing
 */
export function createTestProjectionSettings(partial?: Partial<ProjectionSettings>): ProjectionSettings {
  return {
    simulationModel: partial?.simulationModel || 'historical',
    randomSeed: partial?.randomSeed ?? 42,
    taxableGainRatio: partial?.taxableGainRatio ?? 0.5,
    hsaEligible: partial?.hsaEligible ?? false,
    useBackdoorRoth: partial?.useBackdoorRoth ?? false,
    rothConversion: { enabled: false, ceiling: 'bracket24' as const },
    terminalTaxRate: 0.30,
  };
}
