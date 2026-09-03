/**
 * Validation and abuse limits for the simulation endpoints, shared by the edge
 * and Cloud Run mounts.
 *
 * The edge admits only a verified Firebase identity that also has a row in the
 * application `users` table. The Cloud Run copy stays unauthenticated: it is
 * the rollback target for browser bundles that send no token. Either way one
 * request fans out to CPU-bound work on the Rust service, so everything a
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
/** This leaves headroom above the UI's 25-scenario sweep while bounding batch fan-out. */
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

/**
 * Plan validation for simulation requests. Reuses the domain schema (which
 * bounds ages, rates, and horizon) plus a cap on account count to bound the
 * per-path work.
 */
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

/**
 * The Cloud Run mount's per-IP limits: generous for interactive use, hostile to
 * scripted abuse. The edge keys the same budgets on the verified uid instead —
 * see `SIMULATION_BUDGET` in `worker/simulation-routes.ts`.
 */
export const SIMULATION_RATE_LIMIT = {
  limit: 300,
  windowMs: 60 * 1000,
} as const;

/** Per-instance backstop, exact only within one Cloud Run container. */
export const SIMULATION_PATH_RATE_LIMIT = {
  // A complete Plan refresh costs at most 36,000 paths: 5,000 main paths plus
  // the widest sweep the levers can produce, 31 scenarios at 1,000 paths each.
  // This budget permits 55 complete refreshes per minute, leaving headroom for
  // debounced edits while bounding sustained automation.
  limit: 2_000_000,
  windowMs: 60 * 1000,
} as const;
