/**
 * localStorage persistence.
 *
 * In LOCAL data mode this is the only store for profile and accounts; in
 * CLOUD mode it acts as a write-through cache (crash safety + offline edits).
 */

import type {
  Account,
  RetirementPlan,
  UserProfile,
  SocialSecuritySettings,
  AssumptionSettings,
} from '@/domain/types';
import { accountSchema } from '@/domain/schemas';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';

const LOCAL_DATA_SCHEMA_VERSION = PLAN_SCHEMA_VERSION;

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
  schemaVersion?: number;
  profile?: Partial<UserProfile>;
  socialSecurity?: Partial<SocialSecuritySettings>;
  assumptions?: Partial<AssumptionSettings>;
}

export function loadLocalProfile(ownerId: string | null): LocalProfileData | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ownerKey(STORAGE_KEYS.LOCAL_PROFILE, ownerId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Profile has an invalid shape');
    }
    const parsed = value as LocalProfileData;
    if (parsed.schemaVersion && parsed.schemaVersion > LOCAL_DATA_SCHEMA_VERSION) {
      throw new Error('Browser profile data was saved by a newer app version');
    }
    return parsed;
  } catch (error) {
    throw new Error('Browser profile data could not be loaded', { cause: error });
  }
}

export function saveLocalProfile(plan: RetirementPlan, ownerId: string | null): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const data: LocalProfileData = {
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
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

interface StoredAccounts {
  schemaVersion: number;
  accounts: unknown[];
}

export function loadLocalAccounts(ownerId: string | null): Account[] | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const saved = storage.getItem(ownerKey(STORAGE_KEYS.LOCAL_ACCOUNTS, ownerId));
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    const payload = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as StoredAccounts).accounts)
        ? (parsed as StoredAccounts).accounts
        : null;
    if (!payload) throw new Error('Account collection has an invalid shape');
    if (
      !Array.isArray(parsed)
      && (parsed as StoredAccounts).schemaVersion > LOCAL_DATA_SCHEMA_VERSION
    ) {
      throw new Error('Browser account data was saved by a newer app version');
    }
    return payload.map((account, index) => {
      const result = accountSchema.safeParse(account);
      if (!result.success) {
        throw new Error(`Account ${index + 1} is invalid: ${result.error.issues[0]?.message}`);
      }
      // Parsing is also the migration boundary: legacy ownership, timestamps,
      // taxability, and per-account valuation dates are intentionally stripped.
      return result.data;
    });
  } catch (error) {
    throw new Error('Browser account data could not be loaded', { cause: error });
  }
}

export function saveLocalAccounts(accounts: Account[], ownerId: string | null): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const data: StoredAccounts = {
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      accounts,
    };
    storage.setItem(ownerKey(STORAGE_KEYS.LOCAL_ACCOUNTS, ownerId), JSON.stringify(data));
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
