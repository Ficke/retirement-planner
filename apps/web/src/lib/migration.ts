/**
 * One-time data migration utilities for architectural changes.
 * Handles cleanup of legacy data structures and schema migrations.
 */

export interface MigrationResult {
  success: boolean;
  message: string;
  deletedKeys: string[];
}

/**
 * Clear legacy account data and migration to unified holdings system.
 * This is a one-time migration to eliminate dual account systems.
 */
export function clearLegacyAccountData(): MigrationResult {
  const legacyKeys = [
    // Legacy retirement accounts stored in usePlan state persistence
    'retire_plan_state',
    'retire_plan_accounts',
    // Legacy individual accounts may need refresh for new schema
    'retire_individual_accounts',
    'retire_account_snapshots',
    'retire_catch_up_calculations'
  ];

  const deletedKeys: string[] = [];
  let success = true;

  try {
    legacyKeys.forEach(key => {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        deletedKeys.push(key);
      }
    });

    console.log('Legacy account data migration completed:', { deletedKeys });

    return {
      success,
      message: `Cleared ${deletedKeys.length} legacy data keys. System will initialize with fresh unified account model.`,
      deletedKeys
    };
  } catch (error) {
    console.error('Failed to clear legacy account data:', error);
    return {
      success: false,
      message: `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      deletedKeys
    };
  }
}

/**
 * Check if legacy data exists that needs migration.
 */
export function hasLegacyData(): boolean {
  return localStorage.getItem('retire_plan_state') !== null ||
         localStorage.getItem('retire_plan_accounts') !== null;
}