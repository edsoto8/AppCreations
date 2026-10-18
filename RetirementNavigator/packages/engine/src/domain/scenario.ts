/**
 * Scenarios are diffs over a base household, keyed by entity id. Base edits flow through because a
 * scenario stores only its operations, never a copy of the household.
 *
 * Semantics (docs/financial-model.md §10):
 * - `set`: replace the value at `path` within entity `id` of `collection`.
 * - `unset` without `path`: remove that entity in this scenario. With `path`: reset that field to its
 *   schema default.
 * - `add`: add a new entity (fresh id) to `collection`; `parentId` names the owning person for
 *   `workplacePlans`.
 * - An op referencing an id missing from the base (deleted) is reported as `orphaned` and not applied.
 */
import { z } from 'zod';
import { EntityIdSchema } from './primitives';

export const EntityCollectionSchema = z.enum([
  'household',
  'people',
  'workplacePlans',
  'accounts',
  'otherIncome',
  'pensions',
  'oneTimeEvents',
]);
export type EntityCollection = z.infer<typeof EntityCollectionSchema>;

const PathSchema = z.array(z.union([z.string().min(1), z.number().int().min(0)])).max(8);

export const ScenarioOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set'),
    collection: EntityCollectionSchema,
    id: EntityIdSchema,
    path: PathSchema.min(1),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal('unset'),
    collection: EntityCollectionSchema,
    id: EntityIdSchema,
    path: PathSchema.min(1).nullable().default(null),
  }),
  z.object({
    op: z.literal('add'),
    collection: EntityCollectionSchema.exclude(['household', 'people']),
    parentId: EntityIdSchema.nullable().default(null),
    /** Validated against the collection's schema when applied. */
    entity: z.unknown(),
  }),
]);
export type ScenarioOp = z.infer<typeof ScenarioOpSchema>;

export const ScenarioPresetSchema = z.enum([
  'A_baseline',
  'B_earlyRetirement',
  'C_aggressiveSavings',
  'D_marketDownturn',
  'E_delayedRetirement',
  'F_reducedSpending',
  'G_rothStrategy',
]);
export type ScenarioPreset = z.infer<typeof ScenarioPresetSchema>;

export const ScenarioSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(80),
  baseProfileId: EntityIdSchema,
  preset: ScenarioPresetSchema.nullable().default(null),
  /** Parameters the preset was generated from (e.g. years earlier, shock severity), for display/regeneration. */
  presetParams: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  ops: z.array(ScenarioOpSchema).max(500).default([]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export interface OrphanedOp {
  opIndex: number;
  op: ScenarioOp;
  reason: 'missingEntity' | 'missingParent' | 'invalidPath';
}
