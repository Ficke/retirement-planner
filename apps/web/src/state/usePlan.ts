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
  LoadingState,
  AccountLoadingState,
} from '@/domain/types';
import { getSimulationService } from '@/services/simulation';
import { getAccountsClient } from '@/services/client/accounts-client';
import { getProfileClient } from '@/services/client/profile-client';
import {
  loadUserPreferences,
  saveUserPreferences,
} from '@/lib/persistence';

// Simplified account with real-time holdings
interface AccountWithHoldings {
  account: Account;
  currentBalance: number;
  isLoading: boolean;
  error?: string;
}

// Debounced simulation scheduler to prevent race conditions
let simulationTimeoutId: NodeJS.Timeout | null = null;
const SIMULATION_DELAY = 100; // ms

// Generation counters to discard stale simulation results
let mainSimGeneration = 0;
let ssSimGeneration = 0;
let spendingSimGeneration = 0;
let retirementAgeSimGeneration = 0;

function scheduleSimulations(get: () => any) {
  // Clear any existing timeout
  if (simulationTimeoutId) {
    clearTimeout(simulationTimeoutId);
  }

  // Schedule new simulations with debounce
  simulationTimeoutId = setTimeout(() => {
    const { runSSAnalysis, runSpendingAnalysis, runRetirementAgeAnalysis, runMainSimulation } = get();

    // Always run all simulations
    runSSAnalysis();
    runSpendingAnalysis();
    runRetirementAgeAnalysis();
    runMainSimulation();

    simulationTimeoutId = null;
  }, SIMULATION_DELAY);
}

// --- Profile persistence (localStorage + DB) ---
const PROFILE_STORAGE_KEY = 'retireplan:profile';
let profileDirty = false;
let dbSaveIntervalId: NodeJS.Timeout | null = null;

function saveProfileToLocalStorage(plan: RetirementPlan) {
  try {
    const data = {
      profile: plan.profile,
      socialSecurity: plan.socialSecurity,
      assumptions: plan.assumptions,
    };
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(data));
    profileDirty = true;
  } catch {
    // localStorage full or unavailable — silent
  }
}

function loadProfileFromLocalStorage(): { profile?: Partial<UserProfile>; socialSecurity?: Partial<SocialSecuritySettings>; assumptions?: Partial<AssumptionSettings> } | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function flushProfileToDb(get: () => PlanState) {
  if (!profileDirty) return;
  profileDirty = false;
  try {
    const { plan } = get();
    const client = getProfileClient();
    await client.saveProfile({
      profile: plan.profile as unknown as Record<string, unknown>,
      socialSecurity: plan.socialSecurity as unknown as Record<string, unknown>,
      assumptions: plan.assumptions as unknown as Record<string, unknown>,
    });
  } catch (error) {
    console.error('Failed to save profile to DB:', error);
    profileDirty = true; // retry next time
  }
}

function setupProfileAutoSave(get: () => PlanState) {
  if (dbSaveIntervalId) return; // already set up

  // Periodic save every 30s
  dbSaveIntervalId = setInterval(() => flushProfileToDb(get), 30_000);

  // Save on tab blur / page hide
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      flushProfileToDb(get);
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Save on page unload
  const handleBeforeUnload = () => {
    flushProfileToDb(get);
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
}

function onProfileChanged(get: () => PlanState) {
  const state = get();
  if (!state.profileLoaded) return;
  saveProfileToLocalStorage(state.plan);
}

function validateAccounts(accounts: Account[]): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const account of accounts) {
    const weightSum = account.assetWeights.stocks + account.assetWeights.bonds;
    if (Math.abs(weightSum - 1) > 0.01) {
      errors.push(`Account ${account.name}: Asset weights sum to ${weightSum.toFixed(3)}, expected 1.000`);
    }
    if (account.balance < 0) {
      errors.push(`Account ${account.name}: Balance cannot be negative (${account.balance})`);
    }
  }
  return { isValid: errors.length === 0, errors };
}

interface PlanState {
  plan: RetirementPlan;
  simulationResult: SimulationResult | null;
  isValid: boolean;
  ssAnalysisResult: SSAnalysisResult[] | null;
  spendingAnalysisResult: SpendingAnalysisResult[] | null;
  retirementAgeAnalysisResult: RetirementAgeAnalysisResult[] | null;

  // User preferences
  useServerSideCalculations: boolean;

  // Simulation loading states - one per simulation type
  isSimulatingMain: boolean;
  isSimulatingSS: boolean;
  isSimulatingSpending: boolean;
  isSimulatingRetirementAge: boolean;

  // Accounts state
  accounts: Account[];
  accountsWithHoldings: AccountWithHoldings[];

  // Loading states
  loadingState: AccountLoadingState;
  accountsLoading: LoadingState;

  // Legacy loading states (for backward compatibility)
  isLoading: boolean;
  isCreatingAccount: boolean;
  isAddingSnapshot: boolean;

  // Profile persistence
  profileLoaded: boolean;

  // Error handling with immediate feedback
  error: string | null;
  lastError: string | null;

  // Plan management actions
  loadProfile: () => Promise<void>;
  updatePlan: (updates: {
    profile?: Partial<UserProfile>;
    socialSecurity?: Partial<SocialSecuritySettings>;
    assumptions?: Partial<AssumptionSettings>;
  }) => void;
  setSimulationResult: (result: SimulationResult | null) => void;
  validatePlan: () => Promise<boolean>;
  reset: () => void;
  runSSAnalysis: () => Promise<void>;
  runSpendingAnalysis: () => Promise<void>;
  runRetirementAgeAnalysis: () => Promise<void>;
  runMainSimulation: () => Promise<void>;

  // User preference actions
  setUseServerSideCalculations: (useServerSide: boolean) => void;

  // Account management actions
  loadAccounts: () => Promise<void>;
  createAccount: (data: CreateAccountData) => Promise<Account>;
  updateAccount: (id: string, updates: Partial<Omit<Account, 'id' | 'createdAt'>>) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;

  // Utility actions
  clearError: () => void;
  clearSimulationResults: () => void;
}

// Load initial user preferences
function getInitialPreferences() {
  const saved = loadUserPreferences();
  return {
    useServerSideCalculations: saved?.useServerSideCalculations ?? true,
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
    spendingGrowthRate: 0.00, // Constant real spending (no lifestyle inflation)
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

export const usePlan = create<PlanState>((set, get) => ({
  plan: defaultPlan,
  simulationResult: null,
  isValid: true,
  ssAnalysisResult: null,
  spendingAnalysisResult: null,
  retirementAgeAnalysisResult: null,

  // User preferences (loaded from localStorage)
  ...getInitialPreferences(),

  // Simulation loading states
  isSimulatingMain: false,
  isSimulatingSS: false,
  isSimulatingSpending: false,
  isSimulatingRetirementAge: false,

  // Accounts state
  accounts: [],
  accountsWithHoldings: [],

  // Loading states
  loadingState: { state: 'idle' },
  accountsLoading: 'idle',

  // Legacy loading states (for backward compatibility)
  isLoading: false,
  isCreatingAccount: false,
  isAddingSnapshot: false,

  // Profile persistence
  profileLoaded: false,

  // Error handling
  error: null,
  lastError: null,

  loadProfile: async () => {
    try {
      // Load from DB first
      const client = getProfileClient();
      const dbData = await client.getProfile();

      // Then overlay localStorage (catches unsaved changes from crashes)
      const lsData = loadProfileFromLocalStorage();

      // Merge: defaults < DB < localStorage
      const mergedProfile = {
        ...defaultPlan.profile,
        ...(dbData?.profile as Partial<UserProfile> | undefined),
        ...(lsData?.profile),
      };
      const mergedSS = {
        ...defaultPlan.socialSecurity,
        ...(dbData?.socialSecurity as Partial<SocialSecuritySettings> | undefined),
        ...(lsData?.socialSecurity),
      };
      const mergedAssumptions = {
        ...defaultPlan.assumptions,
        ...(dbData?.assumptions as Partial<AssumptionSettings> | undefined),
        ...(lsData?.assumptions),
      };

      set((state) => ({
        plan: {
          ...state.plan,
          profile: mergedProfile as UserProfile,
          socialSecurity: mergedSS as SocialSecuritySettings,
          assumptions: mergedAssumptions as AssumptionSettings,
        },
        profileLoaded: true,
      }));

      // Start auto-save listeners now that profile is loaded
      setupProfileAutoSave(get);

      console.log('Profile loaded successfully');
    } catch (error) {
      console.error('Failed to load profile, using defaults:', error);
      set({ profileLoaded: true });
      setupProfileAutoSave(get);
    }
  },

  updatePlan: (updates) =>
    set((state) => {
      const newState = {
        plan: {
          ...state.plan,
          ...(updates.profile && { profile: { ...state.plan.profile, ...updates.profile } }),
          ...(updates.socialSecurity && { socialSecurity: { ...state.plan.socialSecurity, ...updates.socialSecurity } }),
          ...(updates.assumptions && { assumptions: { ...state.plan.assumptions, ...updates.assumptions } }),
        },
        ssAnalysisResult: null,
        spendingAnalysisResult: null,
        retirementAgeAnalysisResult: null,
        simulationResult: null,
      };

      scheduleSimulations(get);
      setTimeout(() => onProfileChanged(get), 0);

      return newState;
    }),

  // Load accounts, sync plan.accounts, and schedule simulations
  loadAccounts: async () => {
    const loadStartTime = new Date().toISOString();
    set({
      accountsLoading: 'loading',
      loadingState: { state: 'loading', lastUpdated: loadStartTime },
      isLoading: true,
      error: null,
    });

    try {
      const client = getAccountsClient();
      const accounts = await client.getAccounts();

      // Validate accounts
      const validation = validateAccounts(accounts);
      if (!validation.isValid) {
        console.warn('Account validation issues:', validation.errors);
      }

      const accountsWithHoldings: AccountWithHoldings[] = accounts.map((account) => ({
        account,
        currentBalance: account.balance,
        isLoading: false,
      }));

      set((prev) => ({
        accounts,
        accountsWithHoldings,
        // Keep plan.accounts in sync — this is what simulation methods read
        plan: { ...prev.plan, accounts },
        // Clear stale simulation results
        simulationResult: null,
        ssAnalysisResult: null,
        spendingAnalysisResult: null,
        retirementAgeAnalysisResult: null,
        accountsLoading: 'success',
        loadingState: { state: 'success', lastUpdated: new Date().toISOString() },
        isLoading: false,
        error: null,
      }));

      // Schedule simulation re-runs with updated accounts
      scheduleSimulations(get);

      console.log(`Loaded ${accounts.length} accounts`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load accounts';
      console.error('Failed to load accounts:', error);

      set({
        accountsLoading: 'error',
        loadingState: {
          state: 'error',
          error: errorMessage,
          lastUpdated: new Date().toISOString()
        },
        error: errorMessage,
        lastError: errorMessage,
        isLoading: false,
      });
    }
  },

  createAccount: async (data: CreateAccountData) => {
    set({ isCreatingAccount: true, error: null });

    try {
      const client = getAccountsClient();
      const newAccount = await client.createAccount(data);

      // Refresh data — loadAccounts syncs plan.accounts and schedules simulations
      await get().loadAccounts();

      set({ isCreatingAccount: false });
      return newAccount;
    } catch (error) {
      console.error('Failed to create account:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to create account',
        isCreatingAccount: false,
      });
      throw error;
    }
  },

  updateAccount: async (id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'taxable'>>) => {
    set({ error: null });

    try {
      const client = getAccountsClient();
      await client.updateAccount(id, updates);

      // Refresh data — loadAccounts syncs plan.accounts and schedules simulations
      await get().loadAccounts();
    } catch (error) {
      console.error('Failed to update account:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to update account',
      });
      throw error;
    }
  },

  deleteAccount: async (id: string) => {
    set({ error: null });

    try {
      const client = getAccountsClient();
      await client.deleteAccount(id);

      // Refresh data — loadAccounts syncs plan.accounts and schedules simulations
      await get().loadAccounts();
    } catch (error) {
      console.error('Failed to delete account:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to delete account',
      });
      throw error;
    }
  },

  clearError: () => {
    set({ error: null });
  },

  clearSimulationResults: () => {
    set({
      simulationResult: null,
      ssAnalysisResult: null,
      spendingAnalysisResult: null,
      retirementAgeAnalysisResult: null,
    });
  },

  setUseServerSideCalculations: (useServerSide) =>
    set(() => {
      // Persist preference to localStorage
      saveUserPreferences({ useServerSideCalculations: useServerSide });

      // Update preference and clear all simulation results to force re-calculation
      const newState = {
        useServerSideCalculations: useServerSide,
        ssAnalysisResult: null as SSAnalysisResult[] | null,
        spendingAnalysisResult: null as SpendingAnalysisResult[] | null,
        retirementAgeAnalysisResult: null as RetirementAgeAnalysisResult[] | null,
        simulationResult: null as SimulationResult | null,
      };

      // Schedule all simulations with new calculation method
      scheduleSimulations(get);

      return newState;
    }),

  setSimulationResult: (result) =>
    set(() => ({ simulationResult: result })),

  validatePlan: async () => {
    const { plan } = get();

    try {
      const hasValidAccounts = plan.accounts.length > 0 && plan.accounts.every(account => {
        const weightSum = account.assetWeights.stocks + account.assetWeights.bonds;
        return Math.abs(weightSum - 1) < 0.001;
      });

      const hasValidProfile = plan.profile.age > 0 &&
                             plan.profile.retirementAge > plan.profile.age &&
                             plan.profile.currentSalary >= 0 &&
                             plan.profile.desiredSpending >= 0;

      const isValid = hasValidAccounts && hasValidProfile;
      set({ isValid });
      return isValid;
    } catch {
      set({ isValid: false });
      return false;
    }
  },

  reset: () =>
    set({
      plan: defaultPlan,
      simulationResult: null,
      ssAnalysisResult: null,
      spendingAnalysisResult: null,
      retirementAgeAnalysisResult: null,
      isValid: true,
      profileLoaded: false,
      // Reset simulation loading states
      isSimulatingMain: false,
      isSimulatingSS: false,
      isSimulatingSpending: false,
      isSimulatingRetirementAge: false,
      // Reset accounts state
      accounts: [],
      accountsWithHoldings: [],
      loadingState: { state: 'idle' },
      accountsLoading: 'idle',
      isLoading: false,
      isCreatingAccount: false,
      isAddingSnapshot: false,
      error: null,
      lastError: null,
    }),

  runSSAnalysis: async () => {
    const { plan, useServerSideCalculations } = get();

    const generation = ++ssSimGeneration;
    set({ isSimulatingSS: true });

    const service = getSimulationService();

    try {
      const results = await service.runSocialSecurityAnalysis(plan, useServerSideCalculations);
      if (generation !== ssSimGeneration) return;
      set({ ssAnalysisResult: results, isSimulatingSS: false });
    } catch (error) {
      if (generation !== ssSimGeneration) return;
      console.error('❌ SS analysis failed:', error);
      set({ isSimulatingSS: false, ssAnalysisResult: null });
    }
  },

  runSpendingAnalysis: async () => {
    const { plan, useServerSideCalculations } = get();

    const generation = ++spendingSimGeneration;
    set({ isSimulatingSpending: true });

    const service = getSimulationService();

    try {
      const results = await service.runSpendingAnalysis(plan, useServerSideCalculations);
      if (generation !== spendingSimGeneration) return;
      set({ spendingAnalysisResult: results, isSimulatingSpending: false });
    } catch (error) {
      if (generation !== spendingSimGeneration) return;
      console.error('❌ Spending analysis failed:', error);
      set({ isSimulatingSpending: false, spendingAnalysisResult: null });
    }
  },

  runRetirementAgeAnalysis: async () => {
    const { plan, useServerSideCalculations } = get();

    const generation = ++retirementAgeSimGeneration;
    set({ isSimulatingRetirementAge: true });

    const service = getSimulationService();

    try {
      const results = await service.runRetirementAgeAnalysis(plan, useServerSideCalculations);
      if (generation !== retirementAgeSimGeneration) return;
      set({ retirementAgeAnalysisResult: results, isSimulatingRetirementAge: false });
    } catch (error) {
      if (generation !== retirementAgeSimGeneration) return;
      console.error('❌ Retirement age analysis failed:', error);
      set({ isSimulatingRetirementAge: false, retirementAgeAnalysisResult: null });
    }
  },

  runMainSimulation: async () => {
    const { plan, useServerSideCalculations } = get();

    const generation = ++mainSimGeneration;
    set({ isSimulatingMain: true });

    const service = getSimulationService();

    try {
      const result = await service.runMainSimulation(plan, useServerSideCalculations);

      // Discard stale results if a newer simulation was triggered
      if (generation !== mainSimGeneration) return;

      console.log('✅ Main simulation completed', {
        successProbability: result.successProbability,
        medianTerminalWealth: result.medianTerminalWealth
      });

      set({
        simulationResult: result,
        isSimulatingMain: false
      });
    } catch (error) {
      if (generation !== mainSimGeneration) return;
      console.error('❌ Main simulation failed:', error);
      set({
        isSimulatingMain: false,
        simulationResult: null
      });
    }
  },
}));

// Selectors for individual accounts functionality
export const usePlanSelectors = {
  useAccounts: () => usePlan(state => state.accounts),
  useAccountsWithHoldings: () => usePlan(state => state.accountsWithHoldings),

  // Loading states
  useLoadingState: () => usePlan(state => state.loadingState),
  useAccountsLoading: () => usePlan(state => state.accountsLoading),

  // Legacy loading states (for backward compatibility)
  useIsLoading: () => usePlan(state => state.isLoading),
  useIsCreating: () => usePlan(state => state.isCreatingAccount),
  useIsAddingSnapshot: () => usePlan(state => state.isAddingSnapshot),

  // Error states
  useError: () => usePlan(state => state.error),
  useLastError: () => usePlan(state => state.lastError),

  // Get account by ID
  useAccount: (id: string) => usePlan(state =>
    state.accounts.find((account: Account) => account.id === id)
  ),

  // Get accounts by type
  useAccountsByType: (accountType: string) => usePlan(state =>
    state.accounts.filter((account: Account) => account.type === accountType)
  ),

  // Ready state for UI components
  useIsReady: () => usePlan(state =>
    state.accountsLoading === 'success' && state.loadingState.state === 'success'
  ),
};

// Legacy export for backward compatibility
export const useIndividualAccountsSelectors = usePlanSelectors;
