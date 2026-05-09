/**
 * Simple localStorage utility for persisting user preferences.
 * Profile/plan state persistence is now handled by profile-client + usePlan directly.
 */

const STORAGE_KEYS = {
  USER_PREFERENCES: 'retirement-planner:preferences',
} as const;

interface UserPreferences {
  useServerSideCalculations: boolean;
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
    localStorage.removeItem(STORAGE_KEYS.USER_PREFERENCES);
    localStorage.removeItem('retireplan:profile');
    console.log('Cleared all persisted data');
  } catch (error) {
    console.error('Failed to clear persisted data:', error);
  }
}
