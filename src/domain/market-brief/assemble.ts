/**
 * Assemble a FactsDocument from agent-fetched observations.
 * Does not fetch; only locks field shape + fetched_at + kind=observed.
 */

import { FactSchema, FactsDocumentSchema, type Fact, type FactsDocument } from './schema.js'

export const ObservationInputSchema = FactSchema.omit({
  kind: true,
  derived_from: true,
  fetched_at: true,
}).extend({
  fetched_at: FactSchema.shape.fetched_at.optional(),
})

export type ObservationInput = {
  id: string
  series_id: string
  value: number | string
  unit?: string
  asof: string
  source: string
  caliber: string
  fetched_at?: string
  note?: string
}

export function assembleFacts(opts: {
  focus_markets?: string[]
  observations: ObservationInput[]
  fetched_at?: string
}): FactsDocument {
  const fetchedAt = opts.fetched_at ?? new Date().toISOString()
  if (!opts.observations.length) {
    throw new Error('assembleFacts requires at least one observation')
  }
  const facts: Fact[] = opts.observations.map((raw) => {
    const parsed = ObservationInputSchema.parse(raw)
    return FactSchema.parse({
      ...parsed,
      fetched_at: parsed.fetched_at ?? fetchedAt,
      kind: 'observed' as const,
    })
  })
  return FactsDocumentSchema.parse({
    version: 1,
    ...(opts.focus_markets ? { focus_markets: opts.focus_markets } : {}),
    facts,
  })
}
