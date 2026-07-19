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
import { getProfileClient } from '@/services/client/profile-client';
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

// Debounce plan changes before re-running all simulations
const SIMULATION_DELAY = 300; // ms
let simulationTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Generation counters let stale async results be discarded
let mainSimGeneration = 0;
let ssSimGeneration = 0;
let spendingSimGeneration = 0;
let retirementAgeSimGeneration = 0;

function scheduleSimulations(get: () => PlanState) {
  if (simulationTimeoutId) clearTimeout(simulationTimeoutId);
  simulationTimeoutId = setTimeout(() => {
    const { runMainSimulation, runSSAnalysis, runSpendingAnalysis, runRetirementAgeAnalysis } = get();
    runMainSimulation();
    runSSAnalysis();
    runSpendingAnalysis();
    runRetirementAgeAnalysis();
    simulationTimeoutId = null;
  }, SIMULATION_DELAY);
}

// --- Cloud profile flush (cloud mode only) ---
let profileDirty = false;
let dbSaveIntervalId: ReturnType<typeof setInterval> | null = null;

async function flushProfileToDb(get: () => PlanState) {
  const state = get();
  if (!profileDirty || state.dataMode() !== 'cloud') return;
  profileDirty = false;
  try {
    await getProfileClient().saveProfile({
      profile: state.plan.profile as unknown as Record<string, unknown>,
      socialSecurity: state.plan.socialSecurity as unknown as Record<string, unknown>,
      assumptions: state.plan.assumptions as unknown as Record<string, unknown>,
    });
  } catch (error) {
    console.error('Failed to save profile to DB:', error);
    profileDirty = true; // retry on next flush
  }
}

function setupProfileAutoSave(get: () => PlanState) {
  if (dbSaveIntervalId) return;
  dbSaveIntervalId = setInterval(() => flushProfileToDb(get), 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProfileToDb(get);
  });
  window.addEventListener('beforeunload', () => flushProfileToDb(get));
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
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 75000,
    salaryGrowthRate: 0.01,
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
    useBackdoorRoth: true,
  },
};

export type DataMode = 'local' | 'cloud';

interface PlanState {
  plan: RetirementPlan;

  // Auth + mode (authUser is pushed in from the AuthProvider via bootstrap)
  authUser: { id: string } | null;
  cloudSyncEnabled: boolean;
  useServerSideCalculations: boolean;
  dataMode: () => DataMode;

  // Simulation results
  simulationResult: SimulationResult | null;
  ssAnalysisResult: SSAnalysisResult[] | null;
  spendingAnalysisResult: SpendingAnalysisResult[] | null;
  retirementAgeAnalysisResult: RetirementAgeAnalysisResult[] | null;
  isSimulatingMain: boolean;
  isSimulatingSS: boolean;
  isSimulatingSpending: boolean;
  isSimulatingRetirementAge: boolean;

  // Lifecycle
  bootstrapped: boolean;
  error: string | null;

  // Actions
  bootstrap: (authUser: { id: string } | null) => Promise<void>;
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
  runSSAnalysis: () => Promise<void>;
  runSpendingAnalysis: () => Promise<void>;
  runRetirementAgeAnalysis: () => Promise<void>;
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

/** Clear results and reschedule all simulations after a plan change. */
function invalidateResults(get: () => PlanState) {
  scheduleSimulations(get);
  return {
    simulationResult: null as SimulationResult | null,
    ssAnalysisResult: null as SSAnalysisResult[] | null,
    spendingAnalysisResult: null as SpendingAnalysisResult[] | null,
    retirementAgeAnalysisResult: null as RetirementAgeAnalysisResult[] | null,
  };
}

export const usePlan = create<PlanState>((set, get) => ({
  plan: defaultPlan,

  authUser: null,
  ...getInitialPreferences(),
  dataMode: () => (get().authUser && get().cloudSyncEnabled ? 'cloud' : 'local'),

  simulationResult: null,
  ssAnalysisResult: null,
  spendingAnalysisResult: null,
  retirementAgeAnalysisResult: null,
  isSimulatingMain: false,
  isSimulatingSS: false,
  isSimulatingSpending: false,
  isSimulatingRetirementAge: false,

  bootstrapped: false,
  error: null,

  /**
   * Load profile and accounts for the current auth state and start the
   * simulation pipeline. Runs on app start and whenever auth state changes
   * (sign-in and sign-out both re-bootstrap).
   */
  bootstrap: async (authUser) => {
    clearLegacyLocalData();
    set({ authUser });

    const cloud = get().dataMode() === 'cloud';

    // Profile: defaults < cloud < local. Local wins because it may hold
    // changes made moments ago (or before signing in) not yet flushed.
    let dbProfile: Awaited<ReturnType<ReturnType<typeof getProfileClient>['getProfile']>> = null;
    if (cloud) {
      try {
        dbProfile = await getProfileClient().getProfile();
      } catch (error) {
        console.error('Failed to load cloud profile, continuing with local:', error);
      }
    }
    const localProfile = loadLocalProfile();

    const profile = {
      ...defaultPlan.profile,
      ...(dbProfile?.profile as Partial<UserProfile> | undefined),
      ...localProfile?.profile,
    } as UserProfile;
    const socialSecurity = {
      ...defaultPlan.socialSecurity,
      ...(dbProfile?.socialSecurity as Partial<SocialSecuritySettings> | undefined),
      ...localProfile?.socialSecurity,
    } as SocialSecuritySettings;
    const assumptions = {
      ...defaultPlan.assumptions,
      ...(dbProfile?.assumptions as Partial<AssumptionSettings> | undefined),
      ...localProfile?.assumptions,
    } as AssumptionSettings;

    // Accounts
    let accounts: Account[] = [];
    try {
      if (cloud) {
        accounts = await getAccountsClient().getAccounts();
        // First sign-in with data built anonymously: import local accounts.
        const localAccounts = loadLocalAccounts<Account>() ?? [];
        if (accounts.length === 0 && localAccounts.length > 0) {
          for (const local of localAccounts) {
            await getAccountsClient().createAccount({
              name: local.name,
              institution: local.institution,
              type: local.type,
              balance: local.balance,
              stocksPct: local.assetWeights.stocks,
              bondsPct: local.assetWeights.bonds,
            });
          }
          accounts = await getAccountsClient().getAccounts();
        }
      } else {
        accounts = loadLocalAccounts<Account>() ?? [];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load accounts';
      console.error('Failed to load accounts:', error);
      set({ error: message });
    }

    set({
      plan: { profile, socialSecurity, assumptions, accounts },
      bootstrapped: true,
      ...invalidateResults(get),
    });

    setupProfileAutoSave(get);
  },

  updatePlan: (updates) =>
    set((state) => {
      const plan = {
        ...state.plan,
        ...(updates.profile && { profile: { ...state.plan.profile, ...updates.profile } }),
        ...(updates.socialSecurity && {
          socialSecurity: { ...state.plan.socialSecurity, ...updates.socialSecurity },
        }),
        ...(updates.assumptions && {
          assumptions: { ...state.plan.assumptions, ...updates.assumptions },
        }),
      };

      saveLocalProfile(plan);
      profileDirty = true;

      return { plan, ...invalidateResults(get) };
    }),

  createAccount: async (data) => {
    set({ error: null });
    try {
      let accounts: Account[];
      if (get().dataMode() === 'cloud') {
        await getAccountsClient().createAccount(data);
        accounts = await getAccountsClient().getAccounts();
      } else {
        accounts = [...(loadLocalAccounts<Account>() ?? []), newLocalAccount(data)];
        saveLocalAccounts(accounts);
      }
      set((state) => ({ plan: { ...state.plan, accounts }, ...invalidateResults(get) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create account' });
      throw error;
    }
  },

  updateAccount: async (id, updates) => {
    set({ error: null });
    try {
      let accounts: Account[];
      if (get().dataMode() === 'cloud') {
        await getAccountsClient().updateAccount(id, updates);
        accounts = await getAccountsClient().getAccounts();
      } else {
        accounts = (loadLocalAccounts<Account>() ?? []).map((a) =>
          a.id === id
            ? {
                ...a,
                ...updates,
                taxable: (updates.type ?? a.type) === 'Taxable',
                updatedAt: new Date().toISOString(),
              }
            : a,
        );
        saveLocalAccounts(accounts);
      }
      set((state) => ({ plan: { ...state.plan, accounts }, ...invalidateResults(get) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update account' });
      throw error;
    }
  },

  deleteAccount: async (id) => {
    set({ error: null });
    try {
      let accounts: Account[];
      if (get().dataMode() === 'cloud') {
        await getAccountsClient().deleteAccount(id);
        accounts = await getAccountsClient().getAccounts();
      } else {
        accounts = (loadLocalAccounts<Account>() ?? []).filter((a) => a.id !== id);
        saveLocalAccounts(accounts);
      }
      set((state) => ({ plan: { ...state.plan, accounts }, ...invalidateResults(get) }));
    } catch (error) {
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
      const existing = loadLocalAccounts<Account>() ?? [];
      if (existing.length === 0) saveLocalAccounts(get().plan.accounts);
    }
    set({ cloudSyncEnabled: enabled });
    persistPreferences(get);
    await get().bootstrap(get().authUser);
  },

  clearError: () => set({ error: null }),

  runMainSimulation: async () => {
    const { plan, useServerSideCalculations } = get();
    const generation = ++mainSimGeneration;
    set({ isSimulatingMain: true });
    try {
      const result = await getSimulationService().runMainSimulation(plan, useServerSideCalculations);
      if (generation !== mainSimGeneration) return;
      set({ simulationResult: result, isSimulatingMain: false });
    } catch (error) {
      if (generation !== mainSimGeneration) return;
      console.error('Main simulation failed:', error);
      set({ isSimulatingMain: false, simulationResult: null });
    }
  },

  runSSAnalysis: async () => {
    const { plan, useServerSideCalculations } = get();
    const generation = ++ssSimGeneration;
    set({ isSimulatingSS: true });
    try {
      const results = await getSimulationService().runSocialSecurityAnalysis(plan, useServerSideCalculations);
      if (generation !== ssSimGeneration) return;
      set({ ssAnalysisResult: results, isSimulatingSS: false });
    } catch (error) {
      if (generation !== ssSimGeneration) return;
      console.error('SS analysis failed:', error);
      set({ isSimulatingSS: false, ssAnalysisResult: null });
    }
  },

  runSpendingAnalysis: async () => {
    const { plan, useServerSideCalculations } = get();
    const generation = ++spendingSimGeneration;
    set({ isSimulatingSpending: true });
    try {
      const results = await getSimulationService().runSpendingAnalysis(plan, useServerSideCalculations);
      if (generation !== spendingSimGeneration) return;
      set({ spendingAnalysisResult: results, isSimulatingSpending: false });
    } catch (error) {
      if (generation !== spendingSimGeneration) return;
      console.error('Spending analysis failed:', error);
      set({ isSimulatingSpending: false, spendingAnalysisResult: null });
    }
  },

  runRetirementAgeAnalysis: async () => {
    const { plan, useServerSideCalculations } = get();
    const generation = ++retirementAgeSimGeneration;
    set({ isSimulatingRetirementAge: true });
    try {
      const results = await getSimulationService().runRetirementAgeAnalysis(plan, useServerSideCalculations);
      if (generation !== retirementAgeSimGeneration) return;
      set({ retirementAgeAnalysisResult: results, isSimulatingRetirementAge: false });
    } catch (error) {
      if (generation !== retirementAgeSimGeneration) return;
      console.error('Retirement age analysis failed:', error);
      set({ isSimulatingRetirementAge: false, retirementAgeAnalysisResult: null });
    }
  },
}));
