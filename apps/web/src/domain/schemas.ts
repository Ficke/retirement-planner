import { z } from 'zod';

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
  type: z.enum(['Taxable', 'Traditional', 'Roth', 'HSA'] as const),
  balance: z.number().min(0, "Balance must be non-negative"),
  assetWeights: assetWeightsSchema,
  taxable: z.boolean(),
  costBasis: z.number().min(0).optional(),
});

export const userProfileSchema = z.object({
  age: z.number().int().min(18, "Age must be at least 18").max(100, "Age must be reasonable"),
  state: z.enum(['CA', 'TX', 'FL', 'NY', 'WA', 'Other'] as const),
  filingStatus: z.enum(['Single', 'MarriedFilingJointly', 'MarriedFilingSeparately', 'HeadOfHousehold'] as const),
  retirementAge: z.number().int().min(50, "Retirement age must be at least 50").max(80, "Retirement age must be reasonable"),
  currentSalary: z.number().min(0, "Salary must be non-negative"),
  salaryGrowthRate: z.number().min(-0.1, "Salary growth rate must be reasonable").max(0.2, "Salary growth rate must be reasonable"),
  desiredSpending: z.number().min(0, "Desired spending must be non-negative"),
  spendingGrowthRate: z.number().min(-0.1, "Spending growth rate must be reasonable").max(0.1, "Spending growth rate must be reasonable"),
  lifeExpectancy: z.number().int().min(65, "Life expectancy must be at least 65").max(120, "Life expectancy must be reasonable"),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "As-of date must be in YYYY-MM-DD format"),
}).refine((profile) => profile.retirementAge > profile.age, {
  message: "Retirement age must be greater than current age",
  path: ["retirementAge"],
}).refine((profile) => profile.lifeExpectancy > profile.retirementAge, {
  message: "Life expectancy must be greater than retirement age",
  path: ["lifeExpectancy"],
});

export const socialSecuritySettingsSchema = z.object({
  enabled: z.boolean(),
  estimatedBenefit: z.number().min(0).optional(),
  claimAge: z.number().int().min(62, "Claim age must be at least 62").max(70, "Claim age must be at most 70"),
  manualOverride: z.boolean(),
});

export const marketAssumptionsSchema = z.object({
  stocks: z.object({
    mean: z.number().min(-0.5).max(0.5),
    vol: z.number().min(0).max(1),
  }),
  bonds: z.object({
    mean: z.number().min(-0.5).max(0.5),
    vol: z.number().min(0).max(1),
  }),
  inflation: z.object({
    mean: z.number().min(0).max(0.1),
    vol: z.number().min(0).max(0.1),
  }),
  correlation: z.array(z.array(z.number().min(-1).max(1))),
});

export const projectionSettingsSchema = z.object({
  preset: z.enum(['Conservative', 'Moderate', 'Aggressive'] as const),
  customReturns: marketAssumptionsSchema.optional(),
  rebalanceAnnually: z.boolean(),
  realDollarDisplay: z.boolean(),
  longevityOverride: z.number().int().min(65).max(120).optional(),
  randomSeed: z.number().int().min(0).optional(),
  simulationModel: z.enum(['historical', 'parametric'] as const),
  useBackdoorRoth: z.boolean(),
});

/** @deprecated Use projectionSettingsSchema instead */
export const assumptionSettingsSchema = projectionSettingsSchema;

export const retirementPlanSchema = z.object({
  profile: userProfileSchema,
  accounts: z.array(accountSchema).min(1, "At least one account is required"),
  socialSecurity: socialSecuritySettingsSchema,
  assumptions: assumptionSettingsSchema,
});

export type InferredAccount = z.infer<typeof accountSchema>;
export type InferredUserProfile = z.infer<typeof userProfileSchema>;
export type InferredSocialSecuritySettings = z.infer<typeof socialSecuritySettingsSchema>;
export type InferredMarketAssumptions = z.infer<typeof marketAssumptionsSchema>;
export type InferredProjectionSettings = z.infer<typeof projectionSettingsSchema>;
/** @deprecated Use InferredProjectionSettings instead */
export type InferredAssumptionSettings = InferredProjectionSettings;
export type InferredRetirementPlan = z.infer<typeof retirementPlanSchema>;