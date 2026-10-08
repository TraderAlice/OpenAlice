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
export const manifestSchema = z.object({
  abiVersion: z.literal(1), moduleId: moduleIdSchema, version: z.string().min(1).max(80), name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''), entry: z.string().min(1).max(200),
  sources: z.array(z.object({ key: sourceKeySchema, name: z.string().min(1).max(200), parameters: z.array(parameterSchema).max(32).default([]) }).strict()).min(1).max(64),
}).strict().superRefine((m, ctx) => {
  if (new Set(m.sources.map(s => s.key)).size !== m.sources.length || m.sources.some(s => new Set(s.parameters.map(p => p.key)).size !== s.parameters.length)) ctx.addIssue({code:'custom', message:'Duplicate source or parameter key'})
})
export const artifactSchema = z.object({ manifest: manifestSchema, files: z.record(z.string(), z.string()) }).strict()
const safeUrl = z.string().url().max(8192).refine(v => { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password })
export const itemSchema = z.object({ externalId: z.string().min(1).max(1024), title: z.string().min(1).max(4096), content: z.string().max(262144), url: safeUrl, publishedAt: z.iso.datetime({offset:true}).refine(value => Number.isFinite(Date.parse(value))) }).strict()
export const batchSchema = z.array(itemSchema).max(256)
export type ModuleSelection = z.infer<typeof moduleSelectionSchema>
export type NewsSubscription = z.infer<typeof subscriptionSchema>
export type NewsModuleManifest = z.infer<typeof manifestSchema>
export type NewsModuleArtifact = z.infer<typeof artifactSchema>
export type ModuleItem = z.infer<typeof itemSchema>
export interface NewsModule { abiVersion: 1; moduleId: string; version: string; collect(input: { sourceKey: string; params: NewsSubscription['params'] }, context: { signal: AbortSignal }): Promise<ModuleItem[]> }
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
