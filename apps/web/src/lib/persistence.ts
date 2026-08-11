/**
 * localStorage persistence.
 *
 * In LOCAL data mode this is the only store for profile and accounts; in
 * CLOUD mode it acts as a write-through cache (crash safety + offline edits).
 */

import type { RetirementPlan, UserProfile, SocialSecuritySettings, AssumptionSettings } from '@/domain/types';

const STORAGE_KEYS = {
  USER_PREFERENCES: 'retirement-planner:preferences',
  LOCAL_ACCOUNTS: 'retireplan:accounts',
  LOCAL_PROFILE: 'retireplan:profile',
} as const;

const ANONYMOUS_OWNER = 'anonymous';

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function ownerKey(base: string, ownerId: string | null): string {
  return `${base}:${ownerId ?? ANONYMOUS_OWNER}`;
}

interface UserPreferences {
  useServerSideCalculations: boolean;
  cloudSyncEnabled: boolean;
}

interface StoredPreferences extends Partial<UserPreferences> {
  /** Pre-rename field; inverted meaning of cloudSyncEnabled. */
  privateAccountsMode?: boolean;
}

export function loadUserPreferences(): UserPreferences | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const saved = storage.getItem(STORAGE_KEYS.USER_PREFERENCES);
    if (!saved) return null;
    const parsed: StoredPreferences = JSON.parse(saved);
    return {
      useServerSideCalculations: parsed.useServerSideCalculations ?? true,
      cloudSyncEnabled:
        parsed.cloudSyncEnabled ?? (parsed.privateAccountsMode != null ? !parsed.privateAccountsMode : true),
    };
  } catch (error) {
    console.error('Failed to load user preferences from localStorage:', error);
    return null;
  }
}

export function saveUserPreferences(preferences: UserPreferences): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(preferences));
  } catch (error) {
    console.error('Failed to save user preferences to localStorage:', error);
  }
}

// --- Profile ---

export interface LocalProfileData {
  profile?: Partial<UserProfile>;
  socialSecurity?: Partial<SocialSecuritySettings>;
  assumptions?: Partial<AssumptionSettings>;
}

export function loadLocalProfile(ownerId: string | null): LocalProfileData | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ownerKey(STORAGE_KEYS.LOCAL_PROFILE, ownerId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLocalProfile(plan: RetirementPlan, ownerId: string | null): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const data: LocalProfileData = {
      profile: plan.profile,
      socialSecurity: plan.socialSecurity,
      assumptions: plan.assumptions,
    };
    storage.setItem(ownerKey(STORAGE_KEYS.LOCAL_PROFILE, ownerId), JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — non-fatal
  }
}

// --- Accounts (local mode) ---

export function loadLocalAccounts<T = unknown>(ownerId: string | null): T[] | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const saved = storage.getItem(ownerKey(STORAGE_KEYS.LOCAL_ACCOUNTS, ownerId));
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalAccounts<T = unknown>(accounts: T[], ownerId: string | null): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(ownerKey(STORAGE_KEYS.LOCAL_ACCOUNTS, ownerId), JSON.stringify(accounts));
  } catch (error) {
    console.error('Failed to save local accounts:', error);
  }
}

// --- Housekeeping ---

/** Remove keys left behind by retired architectures. Safe to run every boot. */
export function clearLegacyLocalData(): void {
  const storage = browserStorage();
  if (!storage) return;
  const legacyKeys = [
    'retire_plan_state',
    'retire_plan_accounts',
    'retire_individual_accounts',
    'retire_account_snapshots',
    'retire_catch_up_calculations',
  ];
  try {
    // Move the former global cache into the anonymous namespace. Never attach
    // unowned browser data to an authenticated Firebase UID automatically.
    for (const base of [STORAGE_KEYS.LOCAL_PROFILE, STORAGE_KEYS.LOCAL_ACCOUNTS]) {
      const anonymousKey = ownerKey(base, null);
      const legacyValue = storage.getItem(base);
      if (legacyValue && !storage.getItem(anonymousKey)) {
        storage.setItem(anonymousKey, legacyValue);
      }
      storage.removeItem(base);
    }
    for (const key of legacyKeys) {
      storage.removeItem(key);
    }
  } catch {
    // non-fatal
  }
}

/** Wipe everything this app stores in the browser. */
export function clearPersistedData(): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEYS.USER_PREFERENCES);
    const ownedPrefixes = [`${STORAGE_KEYS.LOCAL_PROFILE}:`, `${STORAGE_KEYS.LOCAL_ACCOUNTS}:`];
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key && ownedPrefixes.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
  } catch (error) {
    console.error('Failed to clear persisted data:', error);
  }
}
