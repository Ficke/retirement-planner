import { z } from 'zod';
import { simulationPlanSchema, simulationResultSchema } from '@/domain/schemas';

export const SIMULATION_EXPORT_SCHEMA_ID = 'urn:retirement-planner:simulation-export';
export const SIMULATION_EXPORT_SCHEMA_VERSION = '1.0.0';

/**
 * Durable interchange contract for a completed headline simulation.
 *
 * The major version changes only for incompatible edits. Readers may accept
 * additive fields from later minor versions after validating the major version.
 */
export const simulationExportSchema = z.object({
  schema: z.object({
    id: z.literal(SIMULATION_EXPORT_SCHEMA_ID),
    version: z.literal(SIMULATION_EXPORT_SCHEMA_VERSION),
    compatibility: z.literal('Reject unsupported major versions; ignore unknown additive fields.'),
  }).strict(),
  exportedAt: z.string().datetime({ offset: true }),
  privacy: z.object({
    containsSensitiveFinancialData: z.literal(true),
    omittedAccountFields: z.tuple([
      z.literal('id'),
      z.literal('name'),
      z.literal('institution'),
    ]),
  }).strict(),
  units: z.object({
    currency: z.literal('USD'),
    monetaryValues: z.string().min(1),
    ratesAndAssetWeights: z.literal('decimal fractions'),
    probabilities: z.literal('decimal fractions from 0 to 1'),
    ages: z.literal('completed years'),
    periods: z.literal('calendar years'),
  }).strict(),
  engine: z.object({
    kernel: z.literal('retirement-simulation-rust'),
    adapter: z.enum(['server', 'client', 'unknown']),
    kernelVersion: z.string().min(1).nullable(),
    sourceRevision: z.string().min(1).nullable(),
    randomStream: z.literal('chacha12-v1'),
  }).strict(),
  model: z.object({
    simulationModel: z.enum(['historical', 'parametric']),
    returnGeneration: z.enum([
      'historical-circular-block-bootstrap-with-replacement',
      'parametric-fitted-distribution',
    ]),
    returnBasis: z.literal('real annual total returns'),
    annualPortfolioFeeRate: z.literal(0.001),
    marketData: z.object({
      id: z.string().min(1),
      firstYear: z.number().int(),
      lastYear: z.number().int(),
      historicalBlockYears: z.number().int().positive().nullable(),
      statistics: z.object({
        stockRealArithmeticMean: z.number(),
        stockRealVolatility: z.number().nonnegative(),
        bondRealArithmeticMean: z.number(),
        bondRealVolatility: z.number().nonnegative(),
        stockBondCorrelation: z.number().min(-1).max(1),
        inflationArithmeticMean: z.number(),
      }).strict(),
    }).strict(),
    taxLawDollarYear: z.number().int(),
    healthcarePremiumPolicyYear: z.number().int(),
    planSchemaVersion: z.number().int().positive(),
    treatments: z.object({
      cashFlowTiming: z.literal('annual-returns-before-cash-flows'),
      assetAllocation: z.literal('fixed-weights-annual-rebalance-no-tax-or-cost'),
      taxableInvestmentIncome: z.literal('withdrawal-gain-ratio-only-no-annual-tax-drag'),
      estateTaxes: z.literal('not-modeled'),
      taxLaw: z.literal('fixed-current-rules-projected-through-horizon'),
      healthcarePremiumPolicy: z.literal('fixed-current-rules-projected-through-horizon'),
      mortality: z.literal('fixed-life-expectancy-horizon'),
      employment: z.literal('deterministic-through-retirement-age'),
      socialSecurity: z.literal('scheduled-benefit-no-solvency-adjustment'),
      longTermCareTiming: z.enum(['disabled', 'sampled-contiguous-ending-at-horizon']),
    }).strict(),
  }).strict(),
  run: z.object({
    paths: z.number().int().positive(),
    rootSeed: z.number().int().nonnegative(),
  }).strict(),
  semantics: z.object({
    conditionalNature: z.string().min(1),
    successProbability: z.string().min(1),
    riskOfRuin: z.string().min(1),
    terminalWealth: z.string().min(1),
    percentileRanks: z.string().min(1),
    yearlyPercentiles: z.string().min(1),
    representativeCashFlows: z.string().min(1),
    afterTaxTerminalWealth: z.string().min(1),
    outcomeBuckets: z.string().min(1),
  }).strict(),
  input: simulationPlanSchema,
  output: simulationResultSchema,
}).strict();

export type SimulationExport = z.infer<typeof simulationExportSchema>;
