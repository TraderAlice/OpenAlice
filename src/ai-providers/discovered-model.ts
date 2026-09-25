/** Shared discovery contract. Only normalized facts may enter the cache. */
import { z } from 'zod'
import { MODEL_REASONING_EFFORTS } from './model-semantics.js'

const tokens = z.number().int().positive().safe()
export const modelSemanticsSchema = z.object({
  contextWindow: tokens.optional(),
  maxOutputTokens: tokens.optional(),
  reasoning: z.object({
    supported: z.boolean().optional(),
    mode: z.enum(['none', 'optional', 'adaptive', 'required']).optional(),
    efforts: z.array(z.enum(MODEL_REASONING_EFFORTS)).optional(),
    defaultEffort: z.enum(MODEL_REASONING_EFFORTS).optional(),
    defaultEnabled: z.boolean().optional(),
    interleaved: z.boolean().optional(),
  }).optional(),
})
export const discoveredModelSchema = z.object({
  id: z.string().min(1).max(512), label: z.string(),
  semantics: modelSemanticsSchema.optional(),
})
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>
