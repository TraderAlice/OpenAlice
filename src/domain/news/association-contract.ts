import { z } from 'zod'
import { NEWS_COUNTRIES } from '../market-data/reference/countries.js'
import { GICS_SECTOR_ETFS } from '../analysis/sector-catalog.js'

const identity = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
const explanation = z.string().trim().min(1).max(1500)
export const newsCountrySchema = z.enum(NEWS_COUNTRIES.map(country => country.code))
export const newsIndustrySchema = z.enum(GICS_SECTOR_ETFS.map(sector => sector.symbol))
export const newsAssetSchema = z.object({ barId: z.string().min(3).max(500).refine(value => value.indexOf('|') > 0 && value.indexOf('|') < value.length - 1, 'Use a complete sourceId|nativeSymbol'), assetClass: z.enum(['equity', 'crypto', 'currency', 'commodity']) }).strict()
export const newsAssociationInputSchema = z.object({
  version: z.literal(1), storyId: identity,
  revision: z.number().int().positive(), storyRevision: z.number().int().positive(),
  preparedAt: z.iso.datetime({ offset: true }), preparedBy: z.string().trim().min(1).max(120),
  protected: z.boolean().optional(),
  relations: z.array(z.object({
    id: identity, country: newsCountrySchema.optional(), industry: newsIndustrySchema.optional(), asset: newsAssetSchema.optional(),
    kind: z.enum(['mentioned', 'directly-involved', 'conditional-transmission']), explanation, condition: explanation.optional(),
    status: z.enum(['active', 'withdrawn']),
    evidence: z.array(z.object({ reportId: z.number().int().nonnegative(), field: z.enum(['content', 'title']), sha256: z.string().regex(/^[a-f0-9]{64}$/), excerpt: z.string().min(1).max(3000).refine(value => Boolean(value.trim())) }).strict()).min(1).max(20),
  }).strict().superRefine((relation, ctx) => {
    if ([relation.country, relation.industry, relation.asset].filter(Boolean).length !== 1) ctx.addIssue({ code: 'custom', message: 'Use one canonical country, industry or resolved asset' })
    if (relation.kind === 'conditional-transmission' ? !relation.condition || Boolean(relation.country) : relation.condition !== undefined) ctx.addIssue({ code: 'custom', message: 'Conditional transmission needs a separate condition and an industry or asset target' })
  })).max(100),
  unresolved: z.array(z.object({ label: z.string().trim().min(1).max(120), reason: explanation }).strict()).max(100).default([]),
}).strict().refine(value => new Set(value.relations.map(relation => relation.id)).size === value.relations.length, 'Duplicate relation identity')

const savedRevisionSchema = newsAssociationInputSchema.safeExtend({ protected: z.boolean(), authority: z.enum(['operator', 'native']) })
export const newsAssociationRecordSchema = z.object({ version: z.literal(1), storyId: identity, history: z.array(savedRevisionSchema).min(1) }).strict().superRefine((record, ctx) => {
  for (const [index, value] of record.history.entries()) if (value.revision !== index + 1 || value.storyId !== record.storyId) ctx.addIssue({ code: 'custom', message: 'Association history identity or revision mismatch' })
})
export type NewsAssociationInput = z.infer<typeof newsAssociationInputSchema>
export type NewsAssociationAsset = z.infer<typeof newsAssetSchema>
export type NewsAssociationRecord = z.infer<typeof newsAssociationRecordSchema>
export type NewsAssociationView = { status: 'unassessed' | 'current' | 'needs-review'; current?: NewsAssociationRecord['history'][number] }
