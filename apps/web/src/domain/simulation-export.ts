import { z } from 'zod';
import { simulationPlanSchema, simulationResultSchema } from '@/domain/schemas';

/** Increment when the exported JSON contract changes incompatibly. */
export const SIMULATION_EXPORT_VERSION = 1;

export const simulationExportSchema = z.object({
  version: z.literal(SIMULATION_EXPORT_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  paths: z.number().int().positive(),
  input: simulationPlanSchema,
  output: simulationResultSchema,
}).strict();

export type SimulationExport = z.infer<typeof simulationExportSchema>;
