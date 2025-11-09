/**
 * Simple localStorage utility for persisting user preferences and plan state
 * Provides sensible defaults for returning users
 */

import type { RetirementPlan } from '@/domain/types';

const STORAGE_KEYS = {
  PLAN_STATE: 'retirement-planner:plan-state',
  USER_PREFERENCES: 'retirement-planner:preferences',
} as const;

interface UserPreferences {
  useServerSideCalculations: boolean;
}

/**
 * Load saved plan state from localStorage
 * Returns null if no saved state exists
 */
export function loadPlanState(): Partial<RetirementPlan> | null {
  if (typeof window === 'undefined') return null;

  try {
    const saved = localStorage.getItem(STORAGE_KEYS.PLAN_STATE);
    if (!saved) return null;

    const parsed = JSON.parse(saved);
    console.log('📂 Loaded saved plan state from localStorage');
    return parsed;
  } catch (error) {
    console.error('Failed to load plan state from localStorage:', error);
    return null;
  }
}

/**
 * Save plan state to localStorage
 * Only saves user profile and key settings, not simulation results
 */
export function savePlanState(plan: RetirementPlan): void {
  if (typeof window === 'undefined') return;

  try {
    // Only persist user inputs, not computed results
    const toSave: Partial<RetirementPlan> = {
      profile: plan.profile,
      socialSecurity: plan.socialSecurity,
      assumptions: plan.assumptions,
      // Don't save accounts - those come from the database
    };

    localStorage.setItem(STORAGE_KEYS.PLAN_STATE, JSON.stringify(toSave));
  } catch (error) {
    console.error('Failed to save plan state to localStorage:', error);
  }
}

/**
 * Load user preferences from localStorage
 */
export function loadUserPreferences(): UserPreferences | null {
  if (typeof window === 'undefined') return null;

  try {
    const saved = localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
    if (!saved) return null;

    return JSON.parse(saved);
  } catch (error) {
    console.error('Failed to load user preferences from localStorage:', error);
    return null;
  }
}

/**
 * Save user preferences to localStorage
 */
export function saveUserPreferences(preferences: UserPreferences): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(preferences));
  } catch (error) {
    console.error('Failed to save user preferences to localStorage:', error);
  }
}

/**
 * Clear all persisted data
 */
export function clearPersistedData(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEYS.PLAN_STATE);
    localStorage.removeItem(STORAGE_KEYS.USER_PREFERENCES);
    console.log('🗑️  Cleared all persisted data');
  } catch (error) {
    console.error('Failed to clear persisted data:', error);
  }
}
