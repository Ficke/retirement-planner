/**
 * React hook for handling data migrations during app initialization.
 * Ensures clean transitions between architectural changes.
 */

import { useEffect, useState } from 'react';
import { clearLegacyAccountData, hasLegacyData, type MigrationResult } from '@/lib/migration';
import { usePlan } from '@/state/usePlan';
import { useAuth } from '@/lib/firebase';

export function useMigration() {
  const [migrationStatus, setMigrationStatus] = useState<'pending' | 'running' | 'completed' | 'error'>('pending');
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const { loadProfile, loadAccounts } = usePlan();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading || !user) return;

    const runMigration = async () => {
      // Check if migration is needed
      if (!hasLegacyData()) {
        // No migration needed, but still load profile and accounts
        console.log('No legacy data found, loading profile and accounts...');
        await loadProfile();
        await loadAccounts();
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
          // After migration success, load profile and accounts
          console.log('Migration completed successfully, loading profile and accounts...');
          await loadProfile();
          await loadAccounts();
          setMigrationStatus('completed');
          console.log('Migration and loading completed:', result.message);
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
  }, [authLoading, user]);

  return {
    migrationStatus,
    migrationResult,
    isReady: migrationStatus === 'completed'
  };
}
