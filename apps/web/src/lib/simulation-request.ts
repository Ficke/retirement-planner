/**
 * Validation and abuse limits for the public simulation endpoints.
 *
 * These endpoints are reachable without authentication by design (anonymous
 * mode may opt into cloud compute), so they are the app's main abuse surface:
 * every request fans out to CPU-bound work on the Rust service. Everything a
 * client can inflate — path counts, batch sizes, horizon length — is clamped
 * here before the request is forwarded.
 */

import { z } from 'zod';
import { retirementPlanSchema } from '@/domain/schemas';
import { MAX_PLAN_ACCOUNTS } from '@/domain/constants';

/** Hard ceiling on paths per simulation — matches what the UI ever requests. */
export const MAX_PATHS = 5000;
/** Max scenarios in one batch request (UI sweeps use at most ~11). */
export const MAX_BATCH_SIMULATIONS = 40;
/** Max total paths across a batch request. */
export const MAX_BATCH_TOTAL_PATHS = 40_000;

const simulationConfigSchema = z.object({
  paths: z.number().int().min(1).max(MAX_PATHS),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  useHistoricalBootstrap: z.boolean().optional(),
  blockSize: z.number().int().min(1).max(10).optional(),
});

/**
 * Plan validation for simulation requests. Reuses the domain schema (which
 * bounds ages, rates, and horizon) plus a cap on account count to bound the
 * per-path work.
 */
const simulationPlanSchema = retirementPlanSchema.refine(
  (plan) => plan.accounts.length <= MAX_PLAN_ACCOUNTS,
  { message: `Too many accounts (max ${MAX_PLAN_ACCOUNTS})` },
);

export const monteCarloRequestSchema = z.object({
  plan: simulationPlanSchema,
  config: simulationConfigSchema,
});

export const batchRequestSchema = z
  .object({
    simulations: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          plan: simulationPlanSchema,
          config: simulationConfigSchema,
        }),
      )
      .min(1)
      .max(MAX_BATCH_SIMULATIONS),
  })
  .refine(
    (body) =>
      body.simulations.reduce((sum, s) => sum + s.config.paths, 0) <= MAX_BATCH_TOTAL_PATHS,
    { message: `Total paths across a batch may not exceed ${MAX_BATCH_TOTAL_PATHS}` },
  );

/** Per-IP limits: generous for interactive use, hostile to scripted abuse. */
export const SIMULATION_RATE_LIMIT = {
  limit: 60,
  windowMs: 60 * 1000,
} as const;

/** Per-instance backstop; production also needs a distributed quota. */
export const SIMULATION_PATH_RATE_LIMIT = {
  // A normal Overview refresh costs ~36k paths (main + three curves).
  // Allow a few interactive edits while bounding per-instance CPU exposure.
  limit: 120_000,
  windowMs: 60 * 1000,
} as const;
