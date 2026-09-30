/**
 * Build / validate AnalysisDocument (signals layer on top of facts).
 */

import {
  AnalysisDocumentSchema,
  CertaintySchema,
  MarketSignalSchema,
  certaintyFromJudgment,
  type AnalysisDocument,
  type Fact,
  type FactsDocument,
  type Judgment,
  type JudgmentsDocument,
  type MarketSignal,
} from './schema.js'
import { validateFactsDocument, type BriefIssue, type BriefValidateResult } from './validate.js'

export function signalFromJudgment(j: Judgment): MarketSignal {
  const certainty = certaintyFromJudgment(j)
  return MarketSignalSchema.parse({
    id: j.id,
    title: j.claim.length > 40 ? `${j.claim.slice(0, 37)}…` : j.claim,
    conclusion: j.claim,
    certainty,
    evidence_ids: j.evidence_ids,
    interpretation:
      certainty === 'interpretation' || certainty === 'forecast'
        ? [{ id: `${j.id}_i0`, text: j.claim, certainty, evidence_ids: j.evidence_ids }]
        : [],
    hypotheses:
      certainty === 'hypothesis'
        ? [{ id: `${j.id}_h0`, text: j.claim, certainty: 'hypothesis' as const, evidence_ids: j.evidence_ids }]
        : [],
    watch_points: [],
    confidence: j.confidence,
    falsifier: j.falsifier,
  })
}

export function buildAnalysisDocument(opts: {
  asof: string
  facts: FactsDocument | Fact[]
  judgments?: JudgmentsDocument | Judgment[]
  signals?: MarketSignal[]
  focus_markets?: string[]
  data_limitations?: string[]
}): AnalysisDocument {
  const factRows = Array.isArray(opts.facts) ? opts.facts : opts.facts.facts
  const focus =
    opts.focus_markets ??
    (!Array.isArray(opts.facts) ? opts.facts.focus_markets : undefined)

  let signals = opts.signals
  if (!signals?.length) {
    const judgments = opts.judgments
      ? Array.isArray(opts.judgments)
        ? opts.judgments
        : opts.judgments.judgments
      : []
    if (!judgments.length) throw new Error('buildAnalysisDocument needs signals or judgments')
    signals = judgments.map(signalFromJudgment)
  }

  return AnalysisDocumentSchema.parse({
    version: 1,
    asof: opts.asof,
    ...(focus ? { focus_markets: focus } : {}),
    facts: factRows,
    signals,
    data_limitations: opts.data_limitations ?? [],
  })
}

export function validateAnalysisDocument(input: unknown): BriefValidateResult & {
  signal_ids: string[]
} {
  const parsed = AnalysisDocumentSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        level: 'error' as const,
        code: 'analysis_schema',
        message: issue.message,
        path: issue.path.join('.') || undefined,
      })),
      warnings: [],
      asof_span_days: null,
      fact_ids: [],
      signal_ids: [],
    }
  }

  const doc = parsed.data
  const factResult = validateFactsDocument({ version: 1, facts: doc.facts, focus_markets: doc.focus_markets })
  const errors: BriefIssue[] = [...factResult.errors]
  const warnings: BriefIssue[] = [...factResult.warnings]
  const factIds = new Set(factResult.fact_ids)

  for (const [i, signal] of doc.signals.entries()) {
    const path = `signals[${i}]`
    for (const eid of signal.evidence_ids) {
      if (!factIds.has(eid)) {
        errors.push({
          level: 'error',
          code: 'signal_evidence_missing',
          message: `Signal ${signal.id} evidence_id ${eid} not in facts`,
          path,
        })
      }
    }
    if (signal.certainty === 'fact' || signal.certainty === 'derived_fact') {
      warnings.push({
        level: 'warning',
        code: 'signal_certainty_as_fact',
        message: `Signal ${signal.id} conclusion marked ${signal.certainty} — prefer interpretation/hypothesis/forecast for conclusions`,
        path,
      })
    }
    for (const claim of [...signal.interpretation, ...signal.hypotheses]) {
      if (!CertaintySchema.safeParse(claim.certainty).success) continue
      if (claim.certainty === 'hypothesis' && !/可能|或许|推测|尚|待验证|hypothesis|may |might |unclear/i.test(claim.text)) {
        warnings.push({
          level: 'warning',
          code: 'hypothesis_unmarked',
          message: `Hypothesis ${claim.id} text lacks hedge language (可能/或许/尚…)`,
          path,
        })
      }
      if (claim.certainty === 'forecast' && !/如果|若|一旦|若是|if |should |were to/i.test(claim.text)) {
        warnings.push({
          level: 'warning',
          code: 'forecast_unconditional',
          message: `Forecast ${claim.id} should preferably use conditional phrasing (如果/若…)`,
          path,
        })
      }
    }
  }

  if (doc.signals.length > 3) {
    errors.push({ level: 'error', code: 'too_many_signals', message: `At most 3 signals (got ${doc.signals.length})` })
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    asof_span_days: factResult.asof_span_days,
    fact_ids: factResult.fact_ids,
    signal_ids: doc.signals.map((s) => s.id),
  }
}
