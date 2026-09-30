/**
 * Market-brief evidence documents — structured facts / judgments / signals.
 * LLM prose is not the source of truth; these documents are.
 */

import { z } from 'zod'

/** Semantic grade for a claim — Editorial Layer must not upgrade certainty. */
export const CertaintySchema = z.enum([
  'fact',
  'derived_fact',
  'interpretation',
  'hypothesis',
  'forecast',
  'data_limitation',
])

export type Certainty = z.infer<typeof CertaintySchema>

/** How the value was timed / what session it represents. */
export const FactDataTypeSchema = z.enum([
  'official_close',
  'exchange_day_end',
  'intraday',
  'settlement',
  'session_close_utc',
  'release',
  'event',
  'calendar',
  'proxy',
  'derived',
  'unknown',
])

export type FactDataType = z.infer<typeof FactDataTypeSchema>

/** Source tier: A official, B free/low-cost vendor, C professional paid. */
export const FactQualitySchema = z.enum(['A', 'B', 'C'])

export type FactQuality = z.infer<typeof FactQualitySchema>

/** Logical domain — keeps flow/event out of equity-bar semantics. */
export const FactDomainSchema = z.enum([
  'market',
  'flow',
  'macro',
  'event',
  'calendar',
  'derived',
])

export type FactDomain = z.infer<typeof FactDomainSchema>

export const FactSchema = z.object({
  id: z.string().min(1),
  series_id: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  unit: z.string().min(1).optional(),
  /** Observation date (YYYY-MM-DD) or ISO timestamp. */
  asof: z.string().min(1),
  source: z.string().min(1),
  /** Measurement definition, e.g. exchange_day_end | eastmoney_main_force | fred_index_derived. */
  caliber: z.string().min(1),
  fetched_at: z.string().min(1),
  kind: z.enum(['observed', 'derived']).default('observed'),
  derived_from: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
  /** Timing / session semantics for prose (intraday ≠ official_close). */
  data_type: FactDataTypeSchema.optional(),
  /** A = official agency/exchange; B = free/vendor; C = professional paid. */
  quality: FactQualitySchema.optional(),
  domain: FactDomainSchema.optional(),
  /** True when value stands in for another series (e.g. UUP for DXY). */
  is_proxy: z.boolean().optional(),
  /** Canonical series this proxy approximates, e.g. ICE:DXY. */
  proxy_for: z.string().min(1).optional(),
  /** Vendor ticker actually fetched, e.g. UUP or DX-Y.NYB. */
  source_symbol: z.string().min(1).optional(),
})

export const FactsDocumentSchema = z.object({
  version: z.literal(1),
  focus_markets: z.array(z.string().min(1)).optional(),
  facts: z.array(FactSchema),
})

export const JudgmentSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  evidence_ids: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  falsifier: z.string().min(1),
  horizon: z.string().min(1),
  kind: z.enum(['judgment', 'hypothesis']).default('judgment'),
  /** Defaults from kind when omitted: judgment→interpretation, hypothesis→hypothesis. */
  certainty: CertaintySchema.optional(),
})

export const JudgmentsDocumentSchema = z.object({
  version: z.literal(1),
  judgments: z.array(JudgmentSchema).max(3),
})

export const LabeledClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  certainty: CertaintySchema,
  evidence_ids: z.array(z.string().min(1)).optional(),
})

export const MarketSignalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** One-line takeaway; certainty bounds how strongly it may be phrased. */
  conclusion: z.string().min(1),
  certainty: CertaintySchema,
  evidence_ids: z.array(z.string().min(1)).min(1),
  interpretation: z.array(LabeledClaimSchema).default([]),
  hypotheses: z.array(LabeledClaimSchema).default([]),
  watch_points: z.array(z.string().min(1)).max(3).default([]),
  confidence: z.enum(['high', 'medium', 'low']),
  falsifier: z.string().min(1).optional(),
})

/**
 * Analysis-layer object: facts + ≤3 signals + data limitations.
 * Editorial Layer may rewrite presentation only; it must not mutate this document.
 */
export const AnalysisDocumentSchema = z.object({
  version: z.literal(1),
  asof: z.string().min(1),
  focus_markets: z.array(z.string().min(1)).optional(),
  facts: z.array(FactSchema),
  signals: z.array(MarketSignalSchema).min(1).max(3),
  data_limitations: z.array(z.string().min(1)).default([]),
})

export type Fact = z.infer<typeof FactSchema>
export type FactsDocument = z.infer<typeof FactsDocumentSchema>
export type Judgment = z.infer<typeof JudgmentSchema>
export type JudgmentsDocument = z.infer<typeof JudgmentsDocumentSchema>
export type LabeledClaim = z.infer<typeof LabeledClaimSchema>
export type MarketSignal = z.infer<typeof MarketSignalSchema>
export type AnalysisDocument = z.infer<typeof AnalysisDocumentSchema>

export const DeriveOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('delta_bp'),
    id: z.string().min(1),
    from_id: z.string().min(1),
    to_id: z.string().min(1),
    /** When rates are already in percent (5.56), multiply delta by 100 → bp. */
    scale: z.number().default(100),
  }),
  z.object({
    op: z.literal('spread'),
    id: z.string().min(1),
    left_id: z.string().min(1),
    right_id: z.string().min(1),
  }),
  z.object({
    op: z.literal('pct_change'),
    id: z.string().min(1),
    from_id: z.string().min(1),
    to_id: z.string().min(1),
  }),
])

export type DeriveOp = z.infer<typeof DeriveOpSchema>

/** Claim words that require evidence (narrow first version). */
export const EVIDENCE_TRIGGER = /拥挤|减仓|资金转向|避险|crowded|deleverag|flow(?:s|ed)? into|defensive rotation/i

/**
 * Concept-board / thematic money-flow labels must never be cited as Stock Connect
 * Northbound/Southbound (北向/南向) official flow.
 */
export const FORBIDDEN_CONNECT_FLOW_SERIES =
  /概念|板块资金|主力净流入|deep.?stock.?connect.?board|msci.?china.*(flow|资金)|concept.?board.?flow|ths.?moneyflow|eastmoney.?sector.?flow/i

export const CONNECT_FLOW_CLAIM =
  /北向|南向|沪股通|深股通|港股通|northbound|southbound|stock.?connect/i

export function certaintyFromJudgment(j: Judgment): Certainty {
  if (j.certainty) return j.certainty
  return j.kind === 'hypothesis' ? 'hypothesis' : 'interpretation'
}

/** Soft ranking: editorial must not move a claim up this ladder. */
export const CERTAINTY_RANK: Record<Certainty, number> = {
  data_limitation: 0,
  hypothesis: 1,
  forecast: 2,
  interpretation: 3,
  derived_fact: 4,
  fact: 5,
}
