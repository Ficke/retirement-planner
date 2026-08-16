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
import {
  projectionSettingsSchema,
  legacySimulationProfileSchema,
  simulationAccountSchema,
  simulationPlanSchema as currentSimulationPlanSchema,
  socialSecuritySettingsSchema,
} from '@/domain/schemas';
import { MAX_PLAN_ACCOUNTS, PLAN_SCHEMA_VERSION } from '@/domain/constants';

/** Hard ceiling on paths per simulation — matches what the UI ever requests. */
export const MAX_PATHS = 5000;
/** Max scenarios in one batch request (UI sweeps use 17). */
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
/**
 * Keep accepting requests from browser bundles that were already open when the
 * current schema deployed. Every version below the current one is accepted and
 * forwarded unchanged, so Rust can apply the semantics that bundle was built
 * against for the length of the rolling rollout.
 */
const legacySimulationPlanSchema = z
  .object({
    schemaVersion: z.number().int().min(0).max(PLAN_SCHEMA_VERSION - 1).optional(),
    profile: legacySimulationProfileSchema,
    accounts: z.array(simulationAccountSchema),
    socialSecurity: socialSecuritySettingsSchema,
    assumptions: projectionSettingsSchema,
  })
  .transform((plan) => ({
    ...plan,
    schemaVersion: plan.schemaVersion ?? 0,
  }));

const simulationPlanSchema = z
  .union([currentSimulationPlanSchema, legacySimulationPlanSchema])
  .refine(
    (plan) => plan.accounts.length <= MAX_PLAN_ACCOUNTS,
    { message: `Too many accounts (max ${MAX_PLAN_ACCOUNTS})` },
  );

export const monteCarloRequestSchema = z.object({
  plan: simulationPlanSchema,
  config: simulationConfigSchema,
});

export const batchRequestSchema = z
  .object({
    responseMode: z.enum(['full', 'summary']).default('full'),
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
  limit: 300,
  windowMs: 60 * 1000,
} as const;

/** Per-instance backstop; production also needs a distributed quota. */
export const SIMULATION_PATH_RATE_LIMIT = {
  // An Overview refresh costs ~10k paths (5k main + 17 swept points at 300).
  // Sized so no human reaches it: the 300ms edit debounce and the 500ms sweep
  // delay cap a person at roughly 75 refreshes per minute even when tapping a
  // slider and waiting exactly the settle time, so this leaves ~30% headroom
  // above a rate nobody sustains. Scripted abuse still stops here, and
  // max-instances bounds the total compute any one caller can provoke.
  limit: 1_000_000,
  windowMs: 60 * 1000,
} as const;
