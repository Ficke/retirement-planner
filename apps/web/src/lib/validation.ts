/**
 * Zod validation schemas for API routes
 */

import { z } from 'zod';

// Account validation
export const CreateAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required').max(100, 'Account name too long'),
  institution: z.string().min(1, 'Institution is required').max(100, 'Institution name too long'),
  type: z.enum(['Taxable', 'Traditional', 'Roth', 'HSA'], {
    message: 'Account type must be Taxable, Traditional, Roth, or HSA',
  }),
});

export const UpdateAccountSchema = CreateAccountSchema.partial();

// Transaction validation
export const CreateTransactionSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required').max(10, 'Symbol too long').toUpperCase(),
  shares: z.number().positive('Shares must be positive'),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (use YYYY-MM-DD)'),
  transactionType: z.enum(['BUY', 'SELL', 'SPLIT', 'DIVIDEND_REINVEST'], {
    message: 'Invalid transaction type',
  }),
  pricePerShare: z.number().positive('Price must be positive').optional(),
  description: z.string().max(500, 'Description too long').optional(),
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
