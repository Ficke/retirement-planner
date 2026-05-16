/**
 * Simple localStorage utility for persisting user preferences.
 * Profile/plan state persistence is now handled by profile-client + usePlan directly.
 */

const STORAGE_KEYS = {
  USER_PREFERENCES: 'retirement-planner:preferences',
  LOCAL_ACCOUNTS: 'retireplan:accounts',
} as const;

interface UserPreferences {
  useServerSideCalculations: boolean;
  privateAccountsMode?: boolean;
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
    localStorage.removeItem(STORAGE_KEYS.LOCAL_ACCOUNTS);
    console.log('Cleared all persisted data');
  } catch (error) {
    console.error('Failed to clear persisted data:', error);
  }
}

/**
 * Local-only accounts (private mode). Stored as raw Account[].
 */
export function loadLocalAccounts<T = unknown>(): T[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.LOCAL_ACCOUNTS);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalAccounts<T = unknown>(accounts: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.LOCAL_ACCOUNTS, JSON.stringify(accounts));
  } catch (error) {
    console.error('Failed to save local accounts:', error);
  }
}
