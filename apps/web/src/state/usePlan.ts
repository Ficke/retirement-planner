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
  AccountSnapshot,
  CreateAccountData,
  CreateSnapshotData,
  LoadingState,
  AccountLoadingState,
} from '@/domain/types';
import { getSimulationService } from '@/services/simulation';
import { getAccountsClient } from '@/services/client/accounts-client';
import { getHoldingsClient } from '@/services/client/holdings-client';
import {
  getAccountAggregationService,
  hasSnapshotData,
} from '@/services/account-aggregation';

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

interface PlanState {
  plan: RetirementPlan;
  simulationResult: SimulationResult | null;
  isValid: boolean;
  ssAnalysisResult: SSAnalysisResult[] | null;
  spendingAnalysisResult: SpendingAnalysisResult[] | null;
  retirementAgeAnalysisResult: RetirementAgeAnalysisResult[] | null;

  // Simulation loading states - one per simulation type
  isSimulatingMain: boolean;
  isSimulatingSS: boolean;
  isSimulatingSpending: boolean;
  isSimulatingRetirementAge: boolean;

  // Accounts state (unified architecture)
  accounts: Account[];
  accountsWithHoldings: AccountWithHoldings[];
  aggregatedAccounts: Account[];

  // Modern loading states with fail-fast design
  loadingState: AccountLoadingState;
  accountsLoading: LoadingState;
  aggregationLoading: LoadingState;

  // Legacy loading states (for backward compatibility)
  isLoading: boolean;
  isCreatingAccount: boolean;
  isAddingSnapshot: boolean;
  isAggregating: boolean;

  // Error handling with immediate feedback
  error: string | null;
  lastError: string | null;

  // Plan management actions
  updateProfile: (profile: Partial<UserProfile>) => void;
  updateSocialSecurity: (settings: Partial<SocialSecuritySettings>) => void;
  updateAssumptions: (settings: Partial<AssumptionSettings>) => void;
  setSimulationResult: (result: SimulationResult | null) => void;
  validatePlan: () => Promise<boolean>;
  reset: () => void;
  runSSAnalysis: () => Promise<void>;
  runSpendingAnalysis: () => Promise<void>;
  runRetirementAgeAnalysis: () => Promise<void>;
  runMainSimulation: () => Promise<void>;

  // Account management actions (consolidated from useIndividualAccounts)
  loadAccounts: () => Promise<void>;
  createAccount: (data: CreateAccountData) => Promise<Account>;
  updateAccount: (id: string, updates: Partial<Omit<Account, 'id' | 'createdAt'>>) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;

  // Aggregation actions
  refreshAggregation: () => Promise<void>;

  // Utility actions
  clearError: () => void;
  clearSimulationResults: () => void;

  // Legacy method (now uses aggregatedAccounts directly)
  getAccounts: () => Promise<Account[]>;
  updateAccounts: () => Promise<void>;
}

const defaultPlan: RetirementPlan = {
  profile: {
    age: 35,
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 75000,
    salaryGrowthRate: 0.03,
    desiredSpending: 50000,
    spendingGrowthRate: 0.00, // Constant real spending (no lifestyle inflation)
    lifeExpectancy: 90,
    asOfDate: new Date().toISOString().split('T')[0],
  },
  accounts: [], // Legacy - now using aggregatedAccounts
  socialSecurity: {
    enabled: true,
    claimAge: 67,
    manualOverride: false,
  },
  assumptions: {
    preset: 'Moderate',
    rebalanceAnnually: true,
    realDollarDisplay: true,
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

  // Simulation loading states
  isSimulatingMain: false,
  isSimulatingSS: false,
  isSimulatingSpending: false,
  isSimulatingRetirementAge: false,

  // Accounts state (unified architecture)
  accounts: [],
  accountsWithHoldings: [],
  aggregatedAccounts: [],

  // Modern loading states
  loadingState: { state: 'idle' },
  accountsLoading: 'idle',
  aggregationLoading: 'idle',

  // Legacy loading states (for backward compatibility)
  isLoading: false,
  isCreatingAccount: false,
  isAddingSnapshot: false,
  isAggregating: false,

  // Error handling
  error: null,
  lastError: null,

  updateProfile: (profileUpdates) =>
    set((state) => {
      // Update state and clear all analysis results (simple invalidation)
      const newState = {
        plan: {
          ...state.plan,
          profile: { ...state.plan.profile, ...profileUpdates },
        },
        ssAnalysisResult: null,
        spendingAnalysisResult: null,
        retirementAgeAnalysisResult: null,
        simulationResult: null,
      };

      console.log('📝 New profile salaryGrowthRate:', newState.plan.profile.salaryGrowthRate);

      // Schedule all simulations
      scheduleSimulations(get);

      return newState;
    }),

  // Load all accounts with modern loading patterns and fail-fast design
  loadAccounts: async () => {
    // Set immediate loading state with timestamp
    const loadStartTime = new Date().toISOString();
    set({
      // Modern loading states
      accountsLoading: 'loading',
      loadingState: { state: 'loading', lastUpdated: loadStartTime },
      // Legacy states for backward compatibility
      isLoading: true,
      error: null,
    });

    try {
      // Parallel loading for performance
      const client = getAccountsClient();
      const [accounts, hasSnapshotData_] = await Promise.all([
        client.getAccounts(),
        hasSnapshotData(),
      ]);

      // Fetch real-time holdings for each account
      const holdingsClient = getHoldingsClient();
      const accountsWithHoldings: AccountWithHoldings[] = await Promise.all(
        accounts.map(async (account) => {
          try {
            const holdingsData = await holdingsClient.getAccountValue(account.id);
            const currentBalance = holdingsData?.totalValue || 0;
            return {
              account,
              currentBalance,
              isLoading: false,
            };
          } catch (error) {
            console.error(`Failed to load holdings for account ${account.id}:`, error);
            return {
              account,
              currentBalance: 0,
              isLoading: false,
              error: error instanceof Error ? error.message : 'Failed to load holdings',
            };
          }
        })
      );

      // Immediate success state update
      set({
        accounts: accounts,
        accountsWithHoldings,
        // Modern loading states
        accountsLoading: 'success',
        loadingState: { state: 'success', lastUpdated: new Date().toISOString() },
        // Legacy states
        isLoading: false,
        error: null,
      });

      console.log(`Loaded ${accounts.length} accounts, ${accountsWithHoldings.length} with real-time holdings`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load accounts';
      console.error('Failed to load individual accounts:', error);

      // Immediate error state update with fail-fast design
      set({
        // Modern loading states
        accountsLoading: 'error',
        loadingState: {
          state: 'error',
          error: errorMessage,
          lastUpdated: new Date().toISOString()
        },
        // Legacy states
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

      // Refresh data
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

  updateAccount: async (id: string, updates: Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'balance' | 'assetWeights' | 'taxable'>>) => {
    set({ error: null });

    try {
      const client = getAccountsClient();
      await client.updateAccount(id, updates);

      // Refresh data
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

      // Refresh data
      await get().loadAccounts();
    } catch (error) {
      console.error('Failed to delete account:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to delete account',
      });
      throw error;
    }
  },

  refreshAggregation: async () => {
    // Set immediate loading state
    set({
      aggregationLoading: 'loading',
      isAggregating: true,
      error: null
    });

    try {
      const aggregationService = getAccountAggregationService();
      // Use simple holdings-based aggregation instead of complex snapshot aggregation
      const aggregatedAccounts = await aggregationService.aggregateAccountsFromHoldings();

      // Validate aggregation
      const validation = aggregationService.validateAggregation(aggregatedAccounts);
      if (!validation.isValid) {
        const errorMessage = `Aggregation issues: ${validation.errors.join(', ')}`;
        console.warn('Aggregation validation failed:', validation.errors);

        set({
          aggregationLoading: 'error',
          error: errorMessage,
          lastError: errorMessage,
          isAggregating: false,
        });
        return;
      }

      // Immediate success state update
      set({
        aggregatedAccounts,
        aggregationLoading: 'success',
        isAggregating: false,
        // Also update the legacy plan.accounts for backward compatibility
        plan: {
          ...get().plan,
          accounts: aggregatedAccounts,
        },
        // Clear simulation result since accounts changed
        simulationResult: null,
      });

      console.log(`Aggregated ${aggregatedAccounts.length} account types`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to aggregate accounts';
      console.error('Failed to refresh aggregation:', error);

      set({
        aggregationLoading: 'error',
        error: errorMessage,
        lastError: errorMessage,
        isAggregating: false,
      });
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

  // Legacy method - now returns aggregatedAccounts directly
  getAccounts: async () => {
    const { aggregatedAccounts } = get();
    if (aggregatedAccounts.length === 0) {
      // If no aggregated accounts, try to refresh
      await get().refreshAggregation();
      return get().aggregatedAccounts;
    }
    return aggregatedAccounts;
  },

  // Legacy method - now calls refreshAggregation
  updateAccounts: async () => {
    await get().refreshAggregation();
  },

  updateSocialSecurity: (ssUpdates) =>
    set((state) => {
      // Update state and clear all results
      const newState = {
        plan: {
          ...state.plan,
          socialSecurity: { ...state.plan.socialSecurity, ...ssUpdates },
        },
        ssAnalysisResult: null,
        spendingAnalysisResult: null,
        retirementAgeAnalysisResult: null,
        simulationResult: null,
      };

      // Schedule all simulations
      scheduleSimulations(get);

      return newState;
    }),

  updateAssumptions: (assumptionUpdates) =>
    set((state) => {
      // Update state and clear all results
      const newState = {
        plan: {
          ...state.plan,
          assumptions: { ...state.plan.assumptions, ...assumptionUpdates },
        },
        ssAnalysisResult: null,
        spendingAnalysisResult: null,
        retirementAgeAnalysisResult: null,
        simulationResult: null,
      };

      // Schedule all simulations
      scheduleSimulations(get);

      return newState;
    }),

  setSimulationResult: (result) =>
    set(() => ({ simulationResult: result })),

  validatePlan: async () => {
    const { plan, aggregatedAccounts } = get();

    try {
      // Use aggregatedAccounts directly instead of calling getAccounts()
      const hasValidAccounts = aggregatedAccounts.length > 0 && aggregatedAccounts.every(account => {
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
      // Reset simulation loading states
      isSimulatingMain: false,
      isSimulatingSS: false,
      isSimulatingSpending: false,
      isSimulatingRetirementAge: false,
      // Reset accounts state
      accounts: [],
      accountsWithHoldings: [],
      aggregatedAccounts: [],
      loadingState: { state: 'idle' },
      accountsLoading: 'idle',
      aggregationLoading: 'idle',
      isLoading: false,
      isCreatingAccount: false,
      isAddingSnapshot: false,
      isAggregating: false,
      error: null,
      lastError: null,
    }),

  runSSAnalysis: async () => {
    const state = get();
    const { plan, aggregatedAccounts, isSimulatingSS } = state;

    if (isSimulatingSS) {
      return;
    }

    set({ isSimulatingSS: true });

    const service = getSimulationService();

    try {
      const planWithAccounts = { ...plan, accounts: aggregatedAccounts };
      const results = await service.runSocialSecurityAnalysis(planWithAccounts);
      set({ ssAnalysisResult: results, isSimulatingSS: false });
    } catch (error) {
      console.error('❌ SS analysis failed:', error);
      set({ isSimulatingSS: false, ssAnalysisResult: null });
    }
  },

  runSpendingAnalysis: async () => {
    const state = get();
    const { plan, aggregatedAccounts, isSimulatingSpending } = state;

    if (isSimulatingSpending) {
      return;
    }

    set({ isSimulatingSpending: true });

    const service = getSimulationService();

    try {
      const planWithAccounts = { ...plan, accounts: aggregatedAccounts };
      const results = await service.runSpendingAnalysis(planWithAccounts);
      set({ spendingAnalysisResult: results, isSimulatingSpending: false });
    } catch (error) {
      console.error('❌ Spending analysis failed:', error);
      set({ isSimulatingSpending: false, spendingAnalysisResult: null });
    }
  },

  runRetirementAgeAnalysis: async () => {
    const state = get();
    const { plan, aggregatedAccounts, isSimulatingRetirementAge } = state;

    if (isSimulatingRetirementAge) {
      return;
    }

    set({ isSimulatingRetirementAge: true });

    const service = getSimulationService();

    try {
      const planWithAccounts = { ...plan, accounts: aggregatedAccounts };
      const results = await service.runRetirementAgeAnalysis(planWithAccounts);
      set({ retirementAgeAnalysisResult: results, isSimulatingRetirementAge: false });
    } catch (error) {
      console.error('❌ Retirement age analysis failed:', error);
      set({ isSimulatingRetirementAge: false, retirementAgeAnalysisResult: null });
    }
  },

  runMainSimulation: async () => {
    const state = get();
    const { plan, aggregatedAccounts, isSimulatingMain } = state;

    if (isSimulatingMain) {
      return;
    }

    const planWithAccounts = { ...plan, accounts: aggregatedAccounts };

    set({ isSimulatingMain: true });

    const service = getSimulationService();

    try {
      const result = await service.runMainSimulation(planWithAccounts);

      console.log('✅ Main simulation completed', {
        successProbability: result.successProbability,
        medianTerminalWealth: result.medianTerminalWealth
      });

      set({
        simulationResult: result,
        isSimulatingMain: false
      });
    } catch (error) {
      console.error('❌ Main simulation failed:', error);
      set({
        isSimulatingMain: false,
        simulationResult: null
      });
    }
  },
}));

// Selectors for individual accounts functionality (consolidated from useIndividualAccounts)
export const usePlanSelectors = {
  // Get all accounts
  useAccounts: () => usePlan(state => state.accounts),

  // Get accounts with real-time holdings
  useAccountsWithHoldings: () => usePlan(state => state.accountsWithHoldings),

  // Legacy selector removed - all components now use useAccountsWithHoldings

  // Get aggregated accounts for projection
  useAggregatedAccounts: () => usePlan(state => state.aggregatedAccounts),

  // Modern loading states with fail-fast design
  useLoadingState: () => usePlan(state => state.loadingState),
  useAccountsLoading: () => usePlan(state => state.accountsLoading),
  useAggregationLoading: () => usePlan(state => state.aggregationLoading),

  // Legacy loading states (for backward compatibility)
  useIsLoading: () => usePlan(state => state.isLoading),
  useIsCreating: () => usePlan(state => state.isCreatingAccount),
  useIsAddingSnapshot: () => usePlan(state => state.isAddingSnapshot),
  useIsAggregating: () => usePlan(state => state.isAggregating),

  // Enhanced error states with immediate feedback
  useError: () => usePlan(state => state.error),
  useLastError: () => usePlan(state => state.lastError),

  // Get mode and capabilities - deprecated properties removed
  // useSnapshotMode and useHasSnapshots have been removed as they don't exist in the current architecture

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
