import { z } from 'zod'

export const moduleIdSchema = z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/).refine(id => !id.startsWith('builtin.'))
export const sourceKeySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/)
export const moduleSelectionSchema = z.object({ moduleId: moduleIdSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/), enabled: z.boolean().default(false) }).strict()
export const subscriptionSchema = z.object({
  id: z.string().min(1).max(128), moduleId: moduleIdSchema, sourceKey: sourceKeySchema,
  name: z.string().min(1).max(200), source: z.string().min(1).max(128), enabled: z.boolean().default(true),
  params: z.record(z.string(), z.union([z.string().max(4096), z.number().finite(), z.boolean()])).default({}),
  categories: z.array(z.string().min(1).max(80)).max(32).default([]),
}).strict()
export const parameterSchema = z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/), label: z.string().min(1).max(200), type: z.enum(['string', 'number', 'boolean']), required: z.boolean().default(false) }).strict()
const manifestV1Schema = z.object({
  abiVersion: z.literal(1), moduleId: moduleIdSchema, version: z.string().min(1).max(80), name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''), entry: z.string().min(1).max(200),
  sources: z.array(z.object({ key: sourceKeySchema, name: z.string().min(1).max(200), parameters: z.array(parameterSchema).max(32).default([]) }).strict()).min(1).max(64),
}).strict()
const credentialSchema = z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/), label: z.string().min(1).max(200) }).strict()
export const manifestSchema = z.discriminatedUnion('abiVersion', [
  manifestV1Schema,
  manifestV1Schema.extend({ abiVersion: z.literal(2), credentials: z.array(credentialSchema).max(8) }).strict(),
]).superRefine((m, ctx) => {
  if (new Set(m.sources.map(s => s.key)).size !== m.sources.length || m.sources.some(s => new Set(s.parameters.map(p => p.key)).size !== s.parameters.length)) ctx.addIssue({code:'custom', message:'Duplicate source or parameter key'})
  if (m.abiVersion === 2 && new Set(m.credentials.map(c => c.key.toLowerCase())).size !== m.credentials.length) ctx.addIssue({code:'custom', message:'Duplicate credential key'})
})
export const artifactSchema = z.object({ manifest: manifestSchema, files: z.record(z.string(), z.string()) }).strict()
const safeUrl = z.string().url().max(8192).refine(v => { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password })
export const itemSchema = z.object({ externalId: z.string().min(1).max(1024), title: z.string().min(1).max(4096), content: z.string().max(262144), url: safeUrl, publishedAt: z.iso.datetime({offset:true}).refine(value => Number.isFinite(Date.parse(value))) }).strict()
export const batchSchema = z.array(itemSchema).max(256)
export const materialSchema = itemSchema.extend({
  publisher: z.string().min(1).max(200).optional(), author: z.string().max(200).optional(),
  kind: z.enum(['article', 'social', 'announcement']).optional(),
  role: z.enum(['official', 'reporting', 'discussion']).optional(), language: z.string().max(40).optional(),
  symbols: z.array(z.string().regex(/^[A-Z0-9_.-]{1,32}:[A-Z0-9_.-]{1,40}$/)).max(32).optional(),
  media: z.array(z.object({ type: z.enum(['image', 'video']), url: safeUrl }).strict()).max(16).optional(),
  quote: z.object({ author: z.string().max(200), text: z.string().max(65536), url: safeUrl }).strict().optional(),
}).strict()
export const checkpointSchema = z.record(z.string().max(80), z.union([z.string().max(16384), z.number().finite(), z.boolean(), z.null()])).nullable()
  .refine(value => JSON.stringify(value).length <= 16384, 'Checkpoint exceeds limit')
export const collectionBatchSchema = z.object({ items: z.array(materialSchema).max(256), checkpoint: checkpointSchema }).strict()
export function collectionResultSchema(abiVersion: 1 | 2) { return abiVersion === 1 ? batchSchema : collectionBatchSchema }
export type NewsCheckpoint = z.infer<typeof checkpointSchema>
export type ModuleMaterial = z.infer<typeof materialSchema>
export type ModuleBatch = z.infer<typeof collectionBatchSchema>
export type ModuleCollection = ModuleItem[] | ModuleBatch
export type ModuleSelection = z.infer<typeof moduleSelectionSchema>
export type NewsSubscription = z.infer<typeof subscriptionSchema>
export type NewsModuleManifest = z.infer<typeof manifestSchema>
export type NewsModuleArtifact = z.infer<typeof artifactSchema>
export type ModuleItem = z.infer<typeof itemSchema>
export interface NewsModule {
  abiVersion: 1 | 2; moduleId: string; version: string
  collect(input: { sourceKey: string; params: NewsSubscription['params']; checkpoint?: NewsCheckpoint }, context: { signal: AbortSignal; credentials?: Record<string, string> }): Promise<ModuleCollection>
}
export interface InstalledModule { manifest: NewsModuleManifest; contentHash: string; approved: boolean }
export interface ModuleStatus {
  moduleId: string | null
  manifest: NewsModuleManifest | null
  contentHash: string
  installed: boolean
  approved: boolean
  desiredEnabled: boolean
  loaded: boolean
  loadedHash: string | null
  state: 'disabled' | 'running' | 'failed' | 'unapproved' | 'missing' | 'invalid'
  lastError: string | null
}
export const NEWS_MODULE_LIMITS = { artifact: 8 * 1024 * 1024, request: 64 * 1024, response: 2 * 1024 * 1024, stderr: 64 * 1024, startupMs: 5000, collectMs: 15000 } as const
