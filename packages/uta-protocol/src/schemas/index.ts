/**
 * Zod schemas — one Request/Response pair per UTA HTTP endpoint.
 *
 * Single source of truth: Alice's client SDK uses these to parse responses;
 * UTA's Hono handlers use the same schemas with `zValidator` on inputs.
 * Schemas are populated incrementally as Step 2 of the UTA-split rollout
 * lifts each route.
 */

import { z } from 'zod'

const guardConfigSchema = z.object({
  type: z.string(),
  options: z.record(z.string(), z.unknown()).default({}),
})

export const utaConfigSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  presetId: z.string(),
  enabled: z.boolean().default(true),
  guards: z.array(guardConfigSchema).default([]),
  presetConfig: z.record(z.string(), z.unknown()).default({}),
  ephemeral: z.boolean().optional(),
}).refine((u) => u.ephemeral !== true || u.presetId === 'mock-simulator', {
  message: 'ephemeral: true is only allowed on mock-simulator UTAs (would destroy real broker history at next boot)',
  path: ['ephemeral'],
})

export type UTAConfig = z.infer<typeof utaConfigSchema>

