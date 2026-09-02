/**
 * Zod validation schemas for API routes
 */

import { z } from 'zod';
import { isAccountId } from '@/domain/account-id';
import {
  legacyStoredProfileSchema,
  projectionSettingsSchema,
  socialSecuritySettingsSchema,
  userProfileSchema,
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
}).strict().refine(({ stocksPct, bondsPct }) => Math.abs(stocksPct + bondsPct - 1) <= 0.000001, {
  message: 'Stock and bond percentages must sum to 1',
  path: ['stocksPct'],
});

const updateAssetWeightsSchema = z.object({
  stocks: z.number().min(0).max(1),
  bonds: z.number().min(0).max(1),
}).strict().refine(
  ({ stocks, bonds }) => Math.abs(stocks + bonds - 1) <= 0.000001,
  { message: 'Stock and bond percentages must sum to 1', path: ['stocks'] },
);

export const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  institution: z.string().max(100).optional(),
  type: z.enum(['Taxable', 'Traditional', 'Roth', 'HSA']).optional(),
  balance: z.number().min(0).max(1_000_000_000_000_000).optional(),
  assetWeights: updateAssetWeightsSchema.optional(),
}).strict();

export const AccountIdSchema = z.string().refine(isAccountId, 'Invalid account ID');

// Profile validation
export const SaveProfileSchema = z.object({
  profile: z.union([userProfileSchema, legacyStoredProfileSchema]),
  socialSecurity: socialSecuritySettingsSchema,
  assumptions: projectionSettingsSchema,
  revision: z.number().int().min(0).nullable(),
}).strict();

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

/** Parse JSON without allowing an unbounded request body into process memory. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RangeError('Request body is too large');
  }

  const reader = request.body?.getReader();
  if (!reader) return JSON.parse('');

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('Request body is too large');
        throw new RangeError('Request body is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
