import { z } from 'zod';
import { MIN_RETIREMENT_AGE } from '@/domain/constants';

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
  user_id: z.string().nullable().optional(),
  balance: z.number().min(0, "Balance must be non-negative").max(1_000_000_000_000_000),
  assetWeights: assetWeightsSchema,
  balanceAsOf: isoDateSchema.optional(),
  taxable: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const userProfileSchema = z.object({
  age: z.number().int().min(18, "Age must be at least 18").max(100, "Age must be reasonable"),
  birthYear: z.number().int().min(1900).max(2200).optional(),
  state: z.enum(['CA', 'TX', 'FL', 'NY', 'WA', 'Other'] as const),
  filingStatus: z.enum(['Single', 'MarriedFilingJointly', 'MarriedFilingSeparately', 'HeadOfHousehold'] as const),
  retirementAge: z.number().int().min(MIN_RETIREMENT_AGE, `Retirement age must be at least ${MIN_RETIREMENT_AGE}`).max(80, "Retirement age must be reasonable"),
  currentSalary: z.number().min(0, "Salary must be non-negative").max(1_000_000_000),
  salaryGrowthRate: z.number().min(-0.1, "Salary growth rate must be reasonable").max(0.2, "Salary growth rate must be reasonable"),
  currentSpending: z.number().min(0, "Current spending must be non-negative").max(1_000_000_000),
  desiredSpending: z.number().min(0, "Desired spending must be non-negative").max(1_000_000_000),
  spendingGrowthRate: z.number().min(-0.1, "Spending growth rate must be reasonable").max(0.1, "Spending growth rate must be reasonable"),
  lifeExpectancy: z.number().int().min(65, "Life expectancy must be at least 65").max(120, "Life expectancy must be reasonable"),
  asOfDate: isoDateSchema,
}).refine((profile) => profile.retirementAge > profile.age, {
  message: "Retirement age must be greater than current age",
  path: ["retirementAge"],
}).refine((profile) => profile.lifeExpectancy > profile.retirementAge, {
  message: "Life expectancy must be greater than retirement age",
  path: ["lifeExpectancy"],
}).refine((profile) => {
  if (profile.birthYear === undefined) return true;
  const calendarAge = Number(profile.asOfDate.slice(0, 4)) - profile.birthYear;
  return calendarAge === profile.age || calendarAge === profile.age + 1;
}, {
  message: "Birth year must be consistent with age and as-of year",
  path: ["birthYear"],
}).transform((profile) => ({
  ...profile,
  birthYear: profile.birthYear ?? Number(profile.asOfDate.slice(0, 4)) - profile.age,
}));

export const socialSecuritySettingsSchema = z.object({
  enabled: z.boolean(),
  estimatedBenefit: z.number().min(0).max(10_000_000).optional(),
  claimAge: z.number().int().min(62, "Claim age must be at least 62").max(70, "Claim age must be at most 70"),
  manualOverride: z.boolean(),
});

export const projectionSettingsSchema = z.object({
  randomSeed: z.number().int().min(0).optional(),
  simulationModel: z.enum(['historical', 'parametric'] as const),
  taxableGainRatio: z.number().min(0).max(1),
  contributions: z.object({
    hsa: z.number().min(0).max(1_000_000),
    traditional: z.number().min(0).max(1_000_000),
    roth: z.number().min(0).max(1_000_000),
    taxable: z.number().min(0).max(1_000_000),
  }),
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
export type InferredProjectionSettings = z.infer<typeof projectionSettingsSchema>;
/** @deprecated Use InferredProjectionSettings instead */
export type InferredAssumptionSettings = InferredProjectionSettings;
export type InferredRetirementPlan = z.infer<typeof retirementPlanSchema>;
