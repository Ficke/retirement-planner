/**
 * Zod validation schemas for API routes
 */

import { z } from 'zod';
import {
  projectionSettingsSchema,
  socialSecuritySettingsSchema,
  userProfileSchema,
  isoDateSchema,
} from '@/domain/schemas';

// Account validation
export const CreateAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required').max(100, 'Account name too long'),
  institution: z.string().max(100, 'Institution name too long').default(''),
  type: z.enum(['Taxable', 'Traditional', 'Roth', 'HSA'], {
    message: 'Account type must be Taxable, Traditional, Roth, or HSA',
  }),
  balance: z.number().min(0, 'Balance must be non-negative').max(1_000_000_000_000_000).default(0),
  stocksPct: z.number().min(0).max(1, 'Stocks percentage must be between 0 and 1').default(0.6),
  bondsPct: z.number().min(0).max(1, 'Bonds percentage must be between 0 and 1').default(0.4),
}).refine(({ stocksPct, bondsPct }) => Math.abs(stocksPct + bondsPct - 1) <= 0.000001, {
  message: 'Stock and bond percentages must sum to 1',
  path: ['stocksPct'],
});

export const UpdateAccountSchema = CreateAccountSchema.partial().extend({
  balance: z.number().min(0).max(1_000_000_000_000_000).optional(),
  assetWeights: z.object({
    stocks: z.number().min(0).max(1),
    bonds: z.number().min(0).max(1),
  }).optional(),
  balanceAsOf: isoDateSchema.optional(),
});

// Profile validation
export const SaveProfileSchema = z.object({
  profile: userProfileSchema,
  socialSecurity: socialSecuritySettingsSchema,
  assumptions: projectionSettingsSchema,
  revision: z.number().int().min(0).nullable(),
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
