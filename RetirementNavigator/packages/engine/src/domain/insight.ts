/**
 * Insights are deterministic what-ifs: each is computed by re-running the engine on a modified
 * household (expressed as scenario ops), never by approximation text. Wording is descriptive
 * ("In this model, ..."), never directive.
 */
import { z } from 'zod';
import { CentsSchema } from './primitives';
import { ScenarioOpSchema } from './scenario';

export const InsightKindSchema = z.enum([
  'savingsIncreaseForGoal',
  'fullMatchValue',
  'retireTwoYearsLater',
  'lifetimeFeeCost',
  'inflationImpact',
  'spendingSensitivity',
  'depletionRisk',
  'ssClaimingAge',
]);
export type InsightKind = z.infer<typeof InsightKindSchema>;

export const InsightSchema = z.object({
  kind: InsightKindSchema,
  title: z.string(),
  /** Descriptive sentence, e.g. "In this model, retiring two years later raises ...". */
  body: z.string(),
  metric: z.object({
    label: z.string(),
    basis: z.enum(['todays', 'nominal']),
    baseline: CentsSchema.nullable(),
    whatIf: CentsSchema.nullable(),
    delta: CentsSchema.nullable(),
  }),
  /** The what-if that was re-run. */
  whatIfOps: z.array(ScenarioOpSchema),
  /** Shown in the "assumptions" disclosure. */
  assumptions: z.array(z.string()).min(1),
  tone: z.enum(['neutral', 'attention']),
});
export type Insight = z.infer<typeof InsightSchema>;
