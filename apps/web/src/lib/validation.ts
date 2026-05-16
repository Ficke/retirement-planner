/**
 * Zod validation schemas for API routes
 */

import { z } from 'zod';

// Account validation
export const CreateAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required').max(100, 'Account name too long'),
  institution: z.string().max(100, 'Institution name too long').default(''),
  type: z.enum(['Taxable', 'Traditional', 'Roth', 'HSA'], {
    message: 'Account type must be Taxable, Traditional, Roth, or HSA',
  }),
  balance: z.number().min(0, 'Balance must be non-negative').optional(),
  stocksPct: z.number().min(0).max(1, 'Stocks percentage must be between 0 and 1').optional(),
  bondsPct: z.number().min(0).max(1, 'Bonds percentage must be between 0 and 1').optional(),
});

export const UpdateAccountSchema = CreateAccountSchema.partial().extend({
  balance: z.number().min(0).optional(),
  assetWeights: z.object({
    stocks: z.number().min(0).max(1),
    bonds: z.number().min(0).max(1),
  }).optional(),
  balanceAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional(),
});

// Profile validation
export const SaveProfileSchema = z.object({
  profile: z.object({
    age: z.number().min(1).max(120),
    state: z.enum(['CA', 'TX', 'FL', 'NY', 'WA', 'Other']),
    filingStatus: z.enum(['Single', 'MarriedFilingJointly', 'MarriedFilingSeparately', 'HeadOfHousehold']),
    retirementAge: z.number().min(1).max(120),
    currentSalary: z.number().min(0),
    salaryGrowthRate: z.number(),
    desiredSpending: z.number().min(0),
    spendingGrowthRate: z.number(),
    lifeExpectancy: z.number().min(1).max(120),
    asOfDate: z.string(),
  }).optional(),
  socialSecurity: z.object({
    enabled: z.boolean(),
    estimatedBenefit: z.number().optional(),
    claimAge: z.number().min(62).max(70),
    manualOverride: z.boolean(),
  }).optional(),
  assumptions: z.object({
    simulationModel: z.enum(['historical', 'parametric']),
    randomSeed: z.number().optional(),
    useBackdoorRoth: z.boolean(),
  }).optional(),
});

// Auth validation
export const SignUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
});

export const SignInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Helper function to validate and return formatted errors
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): {
  success: boolean;
  data?: T;
  errors?: string[];
} {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: result.error.issues.map(err => `${err.path.join('.')}: ${err.message}`),
  };
}
