import { create } from 'zustand';
import type {
  RetirementPlan,
  Account,
  UserProfile,
  SocialSecuritySettings,
  AssumptionSettings,
  SimulationResult,
  SSAnalysisResult,
  SpendingAnalysisResult,
  RetirementAgeAnalysisResult,
  CreateAccountData,
} from '@/domain/types';
import { getSimulationService } from '@/services/simulation';
import { getAccountsClient } from '@/services/client/accounts-client';
import { getProfileClient, ProfileConflictError } from '@/services/client/profile-client';
import { retirementPlanSchema } from '@/domain/schemas';
import { MAX_PLAN_ACCOUNTS } from '@/domain/constants';
import {
  loadUserPreferences,
  saveUserPreferences,
  loadLocalAccounts,
  saveLocalAccounts,
  loadLocalProfile,
  saveLocalProfile,
  clearLegacyLocalData,
} from '@/lib/persistence';

/**
 * Data modes
 * ----------
 * The app has exactly two data modes, derived — never stored separately:
 *
 * - LOCAL:  not signed in, or signed in with cloud sync turned off.
 *           Profile and accounts live in localStorage only.
 * - CLOUD:  signed in with cloud sync on. Profile and accounts persist to
 *           the database; localStorage doubles as a write-through cache so
 *           unsaved changes survive crashes.
 *
 * Independently, simulations run on the cloud engine (Rust service; inputs
 * processed transiently, never stored) or the local engine (Web Worker).
 *
 * `plan` is the single source of truth for everything the simulation reads,
 * including `plan.accounts`.
 */

// Debounce plan changes before re-running the primary result. Sensitivity
// sweeps are lazy and run only while the Overview consumes them.
const SIMULATION_DELAY = 300; // ms
let simulationTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Generation counters let stale async results be discarded
let mainSimGeneration = 0;
let sensitivitySimGeneration = 0;
let activeSimulationController = new AbortController();

function scheduleSimulations(get: () => PlanState) {
  if (simulationTimeoutId) clearTimeout(simulationTimeoutId);
  simulationTimeoutId = setTimeout(() => {
    if (!retirementPlanSchema.safeParse(get().plan).success) {
      simulationTimeoutId = null;
      return;
    }
    get().runMainSimulation();
    simulationTimeoutId = null;
  }, SIMULATION_DELAY);
}

// --- Cloud profile flush (cloud mode only) ---
let profileDirty = false;
let profileSaveInFlight = false;
let profileConflictDetected = false;
let bootstrapGeneration = 0;
let dbSaveIntervalId: ReturnType<typeof setInterval> | null = null;

async function flushProfileToDb(get: () => PlanState, set: PlanSetter) {
  const state = get();
  if (
    !profileDirty
    || profileSaveInFlight
    || profileConflictDetected
    || state.dataMode() !== 'cloud'
  ) return;
  const ownerId = state.authUser?.id;
  const generation = bootstrapGeneration;
  if (!ownerId) return;
  profileSaveInFlight = true;
  profileDirty = false;
  try {
    const revision = await getProfileClient().saveProfile({
      profile: state.plan.profile as unknown as Record<string, unknown>,
      socialSecurity: state.plan.socialSecurity as unknown as Record<string, unknown>,
      assumptions: state.plan.assumptions as unknown as Record<string, unknown>,
    }, state.profileRevision, ownerId);
    if (generation !== bootstrapGeneration || get().authUser?.id !== ownerId) return;
    set({ profileRevision: revision });
  } catch (error) {
    if (generation !== bootstrapGeneration || get().authUser?.id !== ownerId) return;
    console.error('Failed to save profile to DB:', error);
    if (error instanceof ProfileConflictError) {
      profileConflictDetected = true;
      set({ error: error.message });
    } else {
      profileDirty = true; // transient failure: retry on next flush
    }
  } finally {
    profileSaveInFlight = false;
  }
}

function setupProfileAutoSave(get: () => PlanState, set: PlanSetter) {
  if (dbSaveIntervalId) return;
  dbSaveIntervalId = setInterval(() => flushProfileToDb(get, set), 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushProfileToDb(get, set);
  });
  window.addEventListener('beforeunload', () => void flushProfileToDb(get, set));
}

function newLocalAccount(data: CreateAccountData): Account {
  const stocks = data.stocksPct ?? 0.6;
  const now = new Date().toISOString();
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: data.name,
    institution: data.institution,
    type: data.type,
    balance: data.balance ?? 0,
    assetWeights: { stocks, bonds: data.bondsPct ?? 1 - stocks },
    balanceAsOf: now.split('T')[0],
    taxable: data.type === 'Taxable',
    createdAt: now,
    updatedAt: now,
  };
}

const defaultPlan: RetirementPlan = {
  profile: {
    age: 35,
    birthYear: new Date().getFullYear() - 35,
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 75000,
    salaryGrowthRate: 0.01,
    currentSpending: 50000,
    desiredSpending: 50000,
    spendingGrowthRate: 0.0, // constant real spending
    lifeExpectancy: 90,
    asOfDate: new Date().toISOString().split('T')[0],
  },
  accounts: [],
  socialSecurity: {
    enabled: true,
    claimAge: 67,
    manualOverride: false,
  },
  assumptions: {
    simulationModel: 'historical',
    taxableGainRatio: 0.5,
    contributions: {
      hsa: 0,
      traditional: 0,
      roth: 0,
      taxable: 0,
    },
  },
};

export type DataMode = 'local' | 'cloud';
type PlanSetter = (partial: Partial<PlanState>) => void;

interface PlanState {
  plan: RetirementPlan;

  // Auth + mode (authUser is pushed in from the AuthProvider via bootstrap)
  authUser: { id: string } | null;
  cloudAccountReady: boolean;
  cloudAvailable: boolean;
  cloudSyncEnabled: boolean;
  useServerSideCalculations: boolean;
  profileRevision: number | null;
  dataMode: () => DataMode;

  // Simulation results
  simulationResult: SimulationResult | null;
  ssAnalysisResult: SSAnalysisResult[] | null;
  spendingAnalysisResult: SpendingAnalysisResult[] | null;
  retirementAgeAnalysisResult: RetirementAgeAnalysisResult[] | null;
  isSimulatingMain: boolean;
  isSimulatingSensitivities: boolean;

  // Lifecycle
  bootstrapped: boolean;
  error: string | null;

  // Actions
  bootstrap: (authUser: { id: string } | null, cloudAccountReady?: boolean) => Promise<void>;
  updatePlan: (updates: {
    profile?: Partial<UserProfile>;
    socialSecurity?: Partial<SocialSecuritySettings>;
    assumptions?: Partial<AssumptionSettings>;
  }) => void;
  createAccount: (data: CreateAccountData) => Promise<void>;
  updateAccount: (id: string, updates: Partial<Omit<Account, 'id' | 'createdAt'>>) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  setUseServerSideCalculations: (useServerSide: boolean) => void;
  setCloudSyncEnabled: (enabled: boolean) => Promise<void>;
  clearError: () => void;

  runMainSimulation: () => Promise<void>;
  runSensitivityAnalyses: () => Promise<void>;
}

function getInitialPreferences() {
  const saved = loadUserPreferences();
  return {
    useServerSideCalculations: saved?.useServerSideCalculations ?? true,
    cloudSyncEnabled: saved?.cloudSyncEnabled ?? true,
  };
}

function persistPreferences(get: () => PlanState) {
  const { useServerSideCalculations, cloudSyncEnabled } = get();
  saveUserPreferences({ useServerSideCalculations, cloudSyncEnabled });
}

function cacheOwner(state: Pick<PlanState, 'authUser'>): string | null {
  return state.authUser?.id ?? null;
}

/** Cancel obsolete work, clear results, and reschedule the primary result. */
function invalidateResults(get: () => PlanState) {
  activeSimulationController.abort();
  activeSimulationController = new AbortController();
  mainSimGeneration++;
  sensitivitySimGeneration++;
  scheduleSimulations(get);
  return {
    simulationResult: null as SimulationResult | null,
    ssAnalysisResult: null as SSAnalysisResult[] | null,
    spendingAnalysisResult: null as SpendingAnalysisResult[] | null,
    retirementAgeAnalysisResult: null as RetirementAgeAnalysisResult[] | null,
    isSimulatingMain: false,
    isSimulatingSensitivities: false,
  };
}

export const usePlan = create<PlanState>((set, get) => ({
  plan: defaultPlan,

  authUser: null,
  cloudAccountReady: false,
  cloudAvailable: false,
  ...getInitialPreferences(),
  profileRevision: null,
  dataMode: () => (
    get().authUser
    && get().cloudAccountReady
    && get().cloudAvailable
    && get().cloudSyncEnabled
      ? 'cloud'
      : 'local'
  ),

  simulationResult: null,
  ssAnalysisResult: null,
  spendingAnalysisResult: null,
  retirementAgeAnalysisResult: null,
  isSimulatingMain: false,
  isSimulatingSensitivities: false,

  bootstrapped: false,
  error: null,

  /**
   * Load profile and accounts for the current auth state and start the
   * simulation pipeline. Runs on app start and whenever auth state changes
   * (sign-in and sign-out both re-bootstrap).
   */
  bootstrap: async (authUser, cloudAccountReady = authUser != null) => {
    const generation = ++bootstrapGeneration;
    clearLegacyLocalData();
    profileDirty = false;
    profileConflictDetected = false;
    set({
      authUser,
      cloudAccountReady,
      cloudAvailable: false,
      bootstrapped: false,
      error: null,
    });

    const cloudRequested = Boolean(authUser && cloudAccountReady && get().cloudSyncEnabled);
    const ownerId = authUser?.id ?? null;

    // A cloud bootstrap is all-or-nothing: never combine a cloud profile with
    // stale local accounts (or vice versa). If either read fails, remain in
    // UID-scoped local mode so subsequent edits cannot overwrite unknown cloud
    // state after a partial load.
    let dbProfile: Awaited<ReturnType<ReturnType<typeof getProfileClient>['getProfile']>> = null;
    let cloudAccounts: Account[] | null = null;
    let cloudAvailable = cloudRequested;
    if (cloudRequested) {
      try {
        [dbProfile, cloudAccounts] = await Promise.all([
          getProfileClient().getProfile(ownerId!),
          getAccountsClient().getAccounts(ownerId!),
        ]);
      } catch (error) {
        cloudAvailable = false;
        console.error('Failed to load cloud plan, continuing with UID-scoped local data:', error);
      }
    }
    const localProfile = loadLocalProfile(ownerId);
    const profileSource = cloudAvailable && dbProfile?.profile ? dbProfile.profile : localProfile?.profile;
    const socialSecuritySource = cloudAvailable && dbProfile?.socialSecurity
      ? dbProfile.socialSecurity
      : localProfile?.socialSecurity;
    const assumptionsSource = cloudAvailable && dbProfile?.assumptions
      ? dbProfile.assumptions
      : localProfile?.assumptions;

    const profile = {
      ...defaultPlan.profile,
      ...(profileSource as Partial<UserProfile> | undefined),
      // Plans saved before current/retirement spending were separated used
      // desiredSpending for both phases. Preserve that behavior on migration.
      currentSpending:
        (profileSource as Partial<UserProfile> | undefined)?.currentSpending
        ?? (profileSource as Partial<UserProfile> | undefined)?.desiredSpending
        ?? defaultPlan.profile.currentSpending,
      birthYear:
        (profileSource as Partial<UserProfile> | undefined)?.birthYear
        ?? Number(
          ((profileSource as Partial<UserProfile> | undefined)?.asOfDate
            ?? defaultPlan.profile.asOfDate).slice(0, 4),
        ) - ((profileSource as Partial<UserProfile> | undefined)?.age ?? defaultPlan.profile.age),
    } as UserProfile;
    const socialSecurity = {
      ...defaultPlan.socialSecurity,
      ...(socialSecuritySource as Partial<SocialSecuritySettings> | undefined),
    } as SocialSecuritySettings;
    const assumptions = {
      ...defaultPlan.assumptions,
      ...(assumptionsSource as Partial<AssumptionSettings> | undefined),
      contributions: {
        ...defaultPlan.assumptions.contributions,
        ...(assumptionsSource as Partial<AssumptionSettings> | undefined)?.contributions,
      },
    } as AssumptionSettings;

    // Accounts
    const accounts = cloudAvailable && cloudAccounts
      ? cloudAccounts
      : loadLocalAccounts<Account>(ownerId) ?? [];

    // Auth can change while cloud requests are in flight. Never let an older
    // bootstrap overwrite the newer user's owner-scoped state.
    if (generation !== bootstrapGeneration) return;

    set({
      plan: { profile, socialSecurity, assumptions, accounts },
      cloudAvailable,
      profileRevision: cloudAvailable ? dbProfile?.revision ?? null : null,
      bootstrapped: true,
      error: cloudRequested && !cloudAvailable
        ? 'Cloud data is temporarily unavailable. Browser edits remain local; retrying reloads the cloud copy.'
        : null,
      ...invalidateResults(get),
    });
    if (cloudAvailable) saveLocalAccounts(accounts, ownerId);
    saveLocalProfile({ profile, socialSecurity, assumptions, accounts }, ownerId);

    setupProfileAutoSave(get, set);
  },

  updatePlan: (updates) =>
    set((state) => {
      const candidate = {
        ...state.plan,
        ...(updates.profile && { profile: { ...state.plan.profile, ...updates.profile } }),
        ...(updates.socialSecurity && {
          socialSecurity: { ...state.plan.socialSecurity, ...updates.socialSecurity },
        }),
        ...(updates.assumptions && {
          assumptions: {
            ...state.plan.assumptions,
            ...updates.assumptions,
            ...(updates.assumptions.contributions && {
              contributions: {
                ...state.plan.assumptions.contributions,
                ...updates.assumptions.contributions,
              },
            }),
          },
        }),
      };

      const validation = retirementPlanSchema.safeParse(candidate);
      if (!validation.success) {
        const issue = validation.error.issues[0];
        return {
          error: `Plan change was not applied: ${issue?.message ?? 'invalid plan value'}`,
        };
      }
      const plan = validation.data;

      saveLocalProfile(plan, cacheOwner(state));
      profileDirty = true;

      return { plan, error: null, ...invalidateResults(get) };
    }),

  createAccount: async (data) => {
    set({ error: null });
    const initiatingOwnerId = cacheOwner(get());
    try {
      if (get().plan.accounts.length >= MAX_PLAN_ACCOUNTS) {
        throw new Error(`A plan may contain at most ${MAX_PLAN_ACCOUNTS} accounts`);
      }
      let accounts: Account[];
      if (get().dataMode() === 'cloud') {
        const ownerId = initiatingOwnerId!;
        await getAccountsClient().createAccount(data, ownerId);
        if (get().authUser?.id !== ownerId) return;
        accounts = await getAccountsClient().getAccounts(ownerId);
        if (get().authUser?.id !== ownerId) return;
        saveLocalAccounts(accounts, cacheOwner(get()));
      } else {
        const ownerId = cacheOwner(get());
        accounts = [...(loadLocalAccounts<Account>(ownerId) ?? []), newLocalAccount(data)];
        saveLocalAccounts(accounts, ownerId);
      }
      set((state) => ({ plan: { ...state.plan, accounts }, ...invalidateResults(get) }));
    } catch (error) {
      if (cacheOwner(get()) !== initiatingOwnerId) return;
      set({ error: error instanceof Error ? error.message : 'Failed to create account' });
      throw error;
    }
  },

  updateAccount: async (id, updates) => {
    set({ error: null });
    const initiatingOwnerId = cacheOwner(get());
    try {
      let accounts: Account[];
      if (get().dataMode() === 'cloud') {
        const ownerId = initiatingOwnerId!;
        await getAccountsClient().updateAccount(id, updates, ownerId);
        if (get().authUser?.id !== ownerId) return;
        accounts = await getAccountsClient().getAccounts(ownerId);
        if (get().authUser?.id !== ownerId) return;
        saveLocalAccounts(accounts, cacheOwner(get()));
      } else {
        const ownerId = cacheOwner(get());
        accounts = (loadLocalAccounts<Account>(ownerId) ?? []).map((a) =>
          a.id === id
            ? {
                ...a,
                ...updates,
                taxable: (updates.type ?? a.type) === 'Taxable',
                updatedAt: new Date().toISOString(),
              }
            : a,
        );
        saveLocalAccounts(accounts, ownerId);
      }
      set((state) => ({ plan: { ...state.plan, accounts }, ...invalidateResults(get) }));
    } catch (error) {
      if (cacheOwner(get()) !== initiatingOwnerId) return;
      set({ error: error instanceof Error ? error.message : 'Failed to update account' });
      throw error;
    }
  },

  deleteAccount: async (id) => {
    set({ error: null });
    const initiatingOwnerId = cacheOwner(get());
    try {
      let accounts: Account[];
      if (get().dataMode() === 'cloud') {
        const ownerId = initiatingOwnerId!;
        await getAccountsClient().deleteAccount(id, ownerId);
        if (get().authUser?.id !== ownerId) return;
        accounts = await getAccountsClient().getAccounts(ownerId);
        if (get().authUser?.id !== ownerId) return;
        saveLocalAccounts(accounts, cacheOwner(get()));
      } else {
        const ownerId = cacheOwner(get());
        accounts = (loadLocalAccounts<Account>(ownerId) ?? []).filter((a) => a.id !== id);
        saveLocalAccounts(accounts, ownerId);
      }
      set((state) => ({ plan: { ...state.plan, accounts }, ...invalidateResults(get) }));
    } catch (error) {
      if (cacheOwner(get()) !== initiatingOwnerId) return;
      set({ error: error instanceof Error ? error.message : 'Failed to delete account' });
      throw error;
    }
  },

  setUseServerSideCalculations: (useServerSide) => {
    set({ useServerSideCalculations: useServerSide, ...invalidateResults(get) });
    persistPreferences(get);
  },

  /**
   * Toggle cloud sync for a signed-in user. Turning it off seeds local
   * storage with the currently loaded accounts so nothing goes blank;
   * cloud data stays put for when it's turned back on.
   */
  setCloudSyncEnabled: async (enabled) => {
    if (get().cloudSyncEnabled === enabled) return;
    if (!enabled) {
      saveLocalAccounts(get().plan.accounts, cacheOwner(get()));
      saveLocalProfile(get().plan, cacheOwner(get()));
    }
    set({ cloudSyncEnabled: enabled });
    persistPreferences(get);
    await get().bootstrap(get().authUser, get().cloudAccountReady);
  },

  clearError: () => set({ error: null }),

  runMainSimulation: async () => {
    const { plan, useServerSideCalculations } = get();
    const generation = ++mainSimGeneration;
    const signal = activeSimulationController.signal;
    set({ isSimulatingMain: true });
    try {
      const result = await getSimulationService().runMainSimulation(
        plan,
        useServerSideCalculations,
        signal,
      );
      if (generation !== mainSimGeneration) return;
      set({ simulationResult: result, isSimulatingMain: false });
    } catch (error) {
      if (generation !== mainSimGeneration) return;
      if (signal.aborted) return;
      console.error('Main simulation failed:', error);
      set({ isSimulatingMain: false, simulationResult: null });
    }
  },

  runSensitivityAnalyses: async () => {
    if (get().isSimulatingSensitivities) return;
    const { plan, useServerSideCalculations } = get();
    if (!retirementPlanSchema.safeParse(plan).success) return;
    const generation = ++sensitivitySimGeneration;
    const signal = activeSimulationController.signal;
    set({ isSimulatingSensitivities: true });
    try {
      const results = await getSimulationService().runSensitivityAnalyses(
        plan,
        useServerSideCalculations,
        signal,
      );
      if (generation !== sensitivitySimGeneration) return;
      set({
        ssAnalysisResult: results.socialSecurity,
        spendingAnalysisResult: results.spending,
        retirementAgeAnalysisResult: results.retirementAge,
        isSimulatingSensitivities: false,
      });
    } catch (error) {
      if (generation !== sensitivitySimGeneration) return;
      if (signal.aborted) return;
      console.error('Sensitivity analysis failed:', error);
      set({
        isSimulatingSensitivities: false,
        ssAnalysisResult: null,
        spendingAnalysisResult: null,
        retirementAgeAnalysisResult: null,
      });
    }
  },
}));
