/**
 * React hook for handling data migrations during app initialization.
 * Ensures clean transitions between architectural changes.
 */

import { useEffect, useState } from 'react';
import { clearLegacyAccountData, hasLegacyData, type MigrationResult } from '@/lib/migration';
import { usePlan } from '@/state/usePlan';

export function useMigration() {
  const [migrationStatus, setMigrationStatus] = useState<'pending' | 'running' | 'completed' | 'error'>('pending');
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const { updateAccounts } = usePlan();

  useEffect(() => {
    const runMigration = async () => {
      // Check if migration is needed
      if (!hasLegacyData()) {
        // No migration needed, but still load accounts into plan
        console.log('No legacy data found, loading current accounts into plan...');
        await updateAccounts();
        setMigrationStatus('completed');
        return;
      }

      console.log('Legacy data detected, running migration...');
      setMigrationStatus('running');

      try {
        // Run the migration
        const result = clearLegacyAccountData();
        setMigrationResult(result);

        if (result.success) {
          // After migration success, load current accounts into plan
          console.log('Migration completed successfully, loading current accounts...');
          await updateAccounts();
          setMigrationStatus('completed');
          console.log('Migration and account loading completed:', result.message);
        } else {
          setMigrationStatus('error');
          console.error('Migration failed:', result.message);
        }
      } catch (error) {
        console.error('Unexpected migration error:', error);
        setMigrationStatus('error');
        setMigrationResult({
          success: false,
          message: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          deletedKeys: []
        });
      }
    };

    runMigration();
  }, []);

  return {
    migrationStatus,
    migrationResult,
    isReady: migrationStatus === 'completed'
  };
}