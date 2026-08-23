import { z } from 'zod';
import { MIN_RETIREMENT_AGE, PLAN_SCHEMA_VERSION } from '@/domain/constants';
import { ageOn, birthDateFromLegacyAge } from '@/domain/age';
import { DEFAULT_LONG_TERM_CARE } from '@/data/tax-brackets-2025';
import type { UserProfile } from '@/domain/types';

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}, 'Date must be a real calendar date between 1900 and 2200');

export const assetWeightsSchema = z.object({
  stocks: z.number().min(0).max(1),
  bonds: z.number().min(0).max(1),
}).refine((weights) => {
  const sum = weights.stocks + weights.bonds;
  return Math.abs(sum - 1) < 0.001;
}, {
  message: "Asset weights must sum to 1.0",
});

export const accountSchema = z.object({
  id: z.string().min(1, "Account ID is required"),
  name: z.string().min(1, "Account name is required"),
  institution: z.string().max(100),
  type: z.enum(['Taxable', 'Traditional', 'Roth', 'HSA'] as const),
  balance: z.number().min(0, "Balance must be non-negative").max(1_000_000_000_000_000),
  assetWeights: assetWeightsSchema,
});

export const simulationAccountSchema = z.object({
  type: z.enum(['Taxable', 'Traditional', 'Roth', 'HSA'] as const),
  balance: z.number().min(0, "Balance must be non-negative").max(1_000_000_000_000_000),
  assetWeights: assetWeightsSchema,
});

/** Everything a profile carries apart from how retirement spending is expressed. */
const profileBaseShape = {
  birthDate: isoDateSchema,
  state: z.enum(['CA', 'TX', 'FL', 'NY', 'WA', 'Other'] as const),
  filingStatus: z.enum(['Single', 'MarriedFilingJointly', 'MarriedFilingSeparately', 'HeadOfHousehold'] as const),
  retirementAge: z.number().int().min(MIN_RETIREMENT_AGE, `Retirement age must be at least ${MIN_RETIREMENT_AGE}`).max(100, "Retirement age must be reasonable"),
  currentSalary: z.number().min(0, "Salary must be non-negative").max(1_000_000_000),
  salaryGrowthRate: z.number().min(-0.1, "Salary growth rate must be reasonable").max(0.2, "Salary growth rate must be reasonable"),
  currentSpending: z.number().min(0, "Current spending must be non-negative").max(1_000_000_000),
  workingSpendingGrowthRate: z.number().min(-0.1, "Working spending growth rate must be reasonable").max(0.1, "Working spending growth rate must be reasonable"),
  retirementSpendingGrowthRate: z.number().min(-0.1, "Retirement spending growth rate must be reasonable").max(0.1, "Retirement spending growth rate must be reasonable"),
  lifeExpectancy: z.number().int().min(65, "Life expectancy must be at least 65").max(120, "Life expectancy must be reasonable"),
  retirementHealthcare: z.object({
    preMedicarePremium: z.number().min(0, "Premium must be non-negative").max(1_000_000),
    medicarePremium: z.number().min(0, "Premium must be non-negative").max(1_000_000),
    outOfPocket: z.number().min(0, "Out-of-pocket cost must be non-negative").max(1_000_000),
    realGrowthRate: z.number()
      .min(-0.1, "Healthcare growth rate must be reasonable")
      .max(0.1, "Healthcare growth rate must be reasonable"),
  }),
  longTermCare: z.object({
    enabled: z.boolean(),
    costMultiplier: z.number()
      .min(0.5, "Care cost multiplier must be at least 0.5")
      .max(3, "Care cost multiplier must be at most 3"),
  }),
  asOfDate: isoDateSchema,
};

interface ProfileRuleFields {
  birthDate: string;
  asOfDate: string;
  lifeExpectancy: number;
  retirementAge: number;
}

/** Age and horizon rules, shared by the stored and engine-facing profiles. */
function withProfileRules<T extends z.ZodType<ProfileRuleFields>>(schema: T) {
  return schema
    .refine((profile) => {
      const age = ageOn(profile.birthDate, profile.asOfDate);
      return age >= 18 && age <= 100;
    }, {
      message: "Age at the as-of date must be between 18 and 100",
      path: ["birthDate"],
    })
    .refine((profile) => {
      const age = ageOn(profile.birthDate, profile.asOfDate);
      return profile.lifeExpectancy > Math.max(age, profile.retirementAge);
    }, {
      message: "Life expectancy must be greater than current and retirement ages",
      path: ["lifeExpectancy"],
    });
}

/** What the plan stores: retirement spending as a share of today's spending. */
export const userProfileSchema = withProfileRules(z.object({
  ...profileBaseShape,
  retirementSpendingMultiplier: z.number().min(0).max(10),
}));

/** What the engines receive: the multiplier already resolved into dollars. */
export const simulationProfileSchema = withProfileRules(z.object({
  ...profileBaseShape,
  retirementSpending: z.number().min(0).max(1_000_000_000),
}));

/**
 * Profile payloads from browser bundles that predate v3. Storage keeps a birth
 * date and a multiplier, so an old payload's age and dollar target are folded
 * back into those before validation.
 */
export const legacyStoredProfileSchema = z
  .object({
    age: z.number().optional(),
    birthYear: z.number().optional(),
    birthDate: z.string().optional(),
    currentSpending: z.number().optional(),
    desiredSpending: z.number().optional(),
    retirementSpending: z.number().optional(),
    spendingGrowthRate: z.number().optional(),
    asOfDate: isoDateSchema,
  })
  .passthrough()
  .transform(({ age, birthYear, desiredSpending, retirementSpending, spendingGrowthRate, ...rest }) => {
    const currentSpending = rest.currentSpending ?? desiredSpending ?? 0;
    const target = retirementSpending ?? desiredSpending ?? currentSpending;
    return {
      ...rest,
      currentSpending,
      workingSpendingGrowthRate:
        (rest as { workingSpendingGrowthRate?: number }).workingSpendingGrowthRate ?? 0,
      retirementSpendingGrowthRate:
        (rest as { retirementSpendingGrowthRate?: number }).retirementSpendingGrowthRate
        ?? spendingGrowthRate
        ?? 0,
      birthDate:
        rest.birthDate ?? birthDateFromLegacyAge(age ?? 35, birthYear, rest.asOfDate),
      // A bundle built before healthcare existed priced none of it, so zeros --
      // not the current defaults -- are what keep the plan it is saving the
      // plan it thinks it is saving.
      retirementHealthcare:
        (rest as { retirementHealthcare?: UserProfile['retirementHealthcare'] }).retirementHealthcare
        ?? { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
      // Long-term care deliberately does the opposite of the healthcare
      // fallback above: an older bundle gets the model turned ON, so an
      // existing plan's success rate moves. Care risk applies to every
      // household whether or not its plan was written before the model, and
      // an opt-in default would leave that exposure silently unpriced.
      longTermCare:
        (rest as { longTermCare?: UserProfile['longTermCare'] }).longTermCare
        ?? { ...DEFAULT_LONG_TERM_CARE },
      // A plan with no working-year spending has no ratio to recover.
      retirementSpendingMultiplier: currentSpending > 0 ? target / currentSpending : 1,
    };
  })
  .pipe(userProfileSchema);

/**
 * The same normalization for the engine wire, where the retirement target stays
 * a dollar figure rather than a multiplier.
 */
export const legacySimulationProfileSchema = z
  .object({
    age: z.number().optional(),
    birthYear: z.number().optional(),
    birthDate: z.string().optional(),
    currentSpending: z.number().optional(),
    desiredSpending: z.number().optional(),
    retirementSpending: z.number().optional(),
    spendingGrowthRate: z.number().optional(),
    asOfDate: isoDateSchema,
  })
  .passthrough()
  .transform(({ age, birthYear, desiredSpending, retirementSpending, spendingGrowthRate, ...rest }) => ({
    ...rest,
    currentSpending: rest.currentSpending ?? desiredSpending ?? 0,
    workingSpendingGrowthRate:
      (rest as { workingSpendingGrowthRate?: number }).workingSpendingGrowthRate ?? 0,
    retirementSpendingGrowthRate:
      (rest as { retirementSpendingGrowthRate?: number }).retirementSpendingGrowthRate
      ?? spendingGrowthRate
      ?? 0,
    birthDate: rest.birthDate ?? birthDateFromLegacyAge(age ?? 35, birthYear, rest.asOfDate),
    retirementSpending: retirementSpending ?? desiredSpending ?? rest.currentSpending ?? 0,
    // A bundle built before healthcare existed priced none of it, so zeros --
    // not the current defaults -- are what reproduce the projection it expects.
    // Matches the Rust service, where the field carries #[serde(default)].
    retirementHealthcare:
      (rest as { retirementHealthcare?: UserProfile['retirementHealthcare'] }).retirementHealthcare
      ?? { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    // On, for the reason given at the stored-profile fallback above.
    longTermCare:
      (rest as { longTermCare?: UserProfile['longTermCare'] }).longTermCare
      ?? { ...DEFAULT_LONG_TERM_CARE },
  }))
  .pipe(simulationProfileSchema);

export const socialSecuritySettingsSchema = z.object({
  enabled: z.boolean(),
  estimatedBenefit: z.number().min(0).max(10_000_000).optional(),
  claimAge: z.number().int().min(62, "Claim age must be at least 62").max(70, "Claim age must be at most 70"),
  manualOverride: z.boolean(),
});

export const rothConversionPolicySchema = z.object({
  enabled: z.boolean(),
  ceiling: z.enum(['bracket12', 'bracket22', 'bracket24', 'bracket32', 'irmaaTier'] as const),
});

export const projectionSettingsSchema = z.object({
  // Accept plans saved by older app revisions, then normalize them to the
  // single app-wide root seed.
  randomSeed: z.number().int().min(0).max(2 ** 32 - 1).default(42),
  simulationModel: z.enum(['historical', 'parametric'] as const),
  taxableGainRatio: z.number().min(0).max(1),
  hsaEligible: z.boolean(),
  useBackdoorRoth: z.boolean(),
  // Defaulted so a plan saved before conversions existed still parses, and so
  // a browser bundle built against the older schema keeps validating.
  rothConversion: rothConversionPolicySchema.default({
    enabled: false,
    ceiling: 'bracket24',
  }),
  terminalTaxRate: z.number().min(0).max(1).default(0.30),
});

/** @deprecated Use projectionSettingsSchema instead */
export const assumptionSettingsSchema = projectionSettingsSchema;

export const retirementPlanSchema = z.object({
  profile: userProfileSchema,
  // A zero-balance / Social-Security-only plan is still a meaningful scenario.
  accounts: z.array(accountSchema),
  socialSecurity: socialSecuritySettingsSchema,
  assumptions: assumptionSettingsSchema,
});

export const simulationPlanSchema = z.object({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  profile: simulationProfileSchema,
  accounts: z.array(simulationAccountSchema),
  socialSecurity: socialSecuritySettingsSchema,
  assumptions: projectionSettingsSchema,
});

const pathProjectionSchema = z.object({
  year: z.number(),
  age: z.number(),
  portfolioValue: z.number(),
  income: z.number(),
  spending: z.number(),
  taxes: z.number(),
  savings: z.number(),
  socialSecurityBenefit: z.number(),
  isRetired: z.boolean(),
  withdrawalTaxable: z.number(),
  withdrawalTraditional: z.number(),
  withdrawalRoth: z.number(),
  rmdAmount: z.number(),
  rothConversion: z.number(),
  depositTaxable: z.number(),
  depositTraditional: z.number(),
  depositRoth: z.number(),
  depositHSA: z.number(),
  withdrawalHSA: z.number(),
  healthcareCost: z.number(),
  // Preserve results produced before long-term care was reported separately.
  longTermCareCost: z.number().default(0),
  insufficientFunds: z.boolean(),
}).strict();

const outcomeCashFlowRowSchema = z.object({
  age: z.number(),
  isRetired: z.boolean(),
  income: z.number(),
  spending: z.number(),
  taxes: z.number(),
  savings: z.number(),
  socialSecurityBenefit: z.number(),
  withdrawalTaxable: z.number(),
  withdrawalTraditional: z.number(),
  withdrawalRoth: z.number(),
  withdrawalHSA: z.number(),
  healthcareCost: z.number(),
  longTermCareCost: z.number().default(0),
}).strict();

/** Runtime contract enforced for results from both Rust execution adapters. */
export const simulationResultSchema = z.object({
  successProbability: z.number(),
  medianTerminalWealth: z.number(),
  medianAfterTaxTerminalWealth: z.number(),
  percentile5TerminalWealth: z.number(),
  percentile10TerminalWealth: z.number(),
  percentile90TerminalWealth: z.number(),
  yearlyProjections: z.array(pathProjectionSchema.extend({
    p5: z.number(),
    p10: z.number(),
    p15: z.number(),
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    p90: z.number(),
  }).strict()),
  outcomeBuckets: z.array(z.object({
    centerPercentile: z.number(),
    lowerPercentile: z.number(),
    upperPercentile: z.number(),
    successProbability: z.number(),
    projections: z.array(outcomeCashFlowRowSchema),
  }).strict()),
  riskOfRuin: z.number(),
}).strict();

export type InferredAccount = z.infer<typeof accountSchema>;
export type InferredUserProfile = z.infer<typeof userProfileSchema>;
export type InferredSocialSecuritySettings = z.infer<typeof socialSecuritySettingsSchema>;
export type InferredProjectionSettings = z.infer<typeof projectionSettingsSchema>;
/** @deprecated Use InferredProjectionSettings instead */
export type InferredAssumptionSettings = InferredProjectionSettings;
export type InferredRetirementPlan = z.infer<typeof retirementPlanSchema>;
export type InferredSimulationPlan = z.infer<typeof simulationPlanSchema>;
