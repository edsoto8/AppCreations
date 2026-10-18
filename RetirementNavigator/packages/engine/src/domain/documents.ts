/**
 * Stored and exported documents. Every document carries `schemaVersion`; `migrate()` upgrades any
 * prior version through a tested chain (one step per version).
 * IndexedDB data is stored UNENCRYPTED on the device (stated in docs and UI).
 */
import { z } from 'zod';
import { EntityIdSchema } from './primitives';
import { HouseholdSchema } from './household';
import { ScenarioSchema } from './scenario';

export const CURRENT_SCHEMA_VERSION = 1 as const;

const Timestamp = z.iso.datetime({ offset: true });

export const ProfileDocSchema = z.object({
  kind: z.literal('profile'),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: EntityIdSchema,
  updatedAt: Timestamp,
  household: HouseholdSchema,
});
export type ProfileDoc = z.infer<typeof ProfileDocSchema>;

export const ScenarioDocSchema = z.object({
  kind: z.literal('scenario'),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: EntityIdSchema,
  updatedAt: Timestamp,
  scenario: ScenarioSchema,
});
export type ScenarioDoc = z.infer<typeof ScenarioDocSchema>;

export const SettingsDocSchema = z.object({
  kind: z.literal('settings'),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.literal('settings'),
  updatedAt: Timestamp,
  dollarBasis: z.enum(['todays', 'nominal']).default('todays'),
  activeProfileId: EntityIdSchema.nullable().default(null),
  onboardingComplete: z.boolean().default(false),
});
export type SettingsDoc = z.infer<typeof SettingsDocSchema>;

export const StoredDocSchema = z.discriminatedUnion('kind', [ProfileDocSchema, ScenarioDocSchema, SettingsDocSchema]);
export type StoredDoc = z.infer<typeof StoredDocSchema>;

/** JSON export bundle (one file holds profiles, their scenarios and settings). */
export const ExportBundleSchema = z.object({
  format: z.literal('retirement-navigator-export'),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  exportedAt: Timestamp,
  profiles: z.array(ProfileDocSchema),
  scenarios: z.array(ScenarioDocSchema),
  settings: SettingsDocSchema.nullable(),
});
export type ExportBundle = z.infer<typeof ExportBundleSchema>;
