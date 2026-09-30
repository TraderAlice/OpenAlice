import {
  EVIDENCE_TRIGGER,
  FactsDocumentSchema,
  JudgmentsDocumentSchema,
  type Fact,
  type FactsDocument,
  type Judgment,
  type JudgmentsDocument,
} from './schema.js'

export type BriefIssue = {
  level: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export type BriefValidateResult = {
  ok: boolean
  errors: BriefIssue[]
  warnings: BriefIssue[]
  asof_span_days: number | null
  fact_ids: string[]
}

function dayKey(asof: string): string | null {
  const m = asof.match(/^(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? null
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`))
  return Math.round(ms / 86_400_000)
}

function collectAsofSpan(facts: Fact[]): { spanDays: number | null; warnings: BriefIssue[] } {
  const days = facts.map((f) => dayKey(f.asof)).filter((d): d is string => Boolean(d)).sort()
  if (days.length === 0) return { spanDays: null, warnings: [] }
  const spanDays = daysBetween(days[0]!, days[days.length - 1]!)
  const warnings: BriefIssue[] = []
  if (spanDays > 1) {
    warnings.push({
      level: 'warning',
      code: 'asof_span',
      message: `Fact asof spans ${spanDays} calendar days (${days[0]} … ${days[days.length - 1]}). Prefer same-session alignment or label stale series.`,
    })
  }
  return { spanDays, warnings }
}

function validateFactsInternal(doc: FactsDocument): BriefIssue[] {
  const issues: BriefIssue[] = []
  const ids = new Set<string>()
  for (const [i, fact] of doc.facts.entries()) {
    const path = `facts[${i}]`
    if (ids.has(fact.id)) {
      issues.push({ level: 'error', code: 'duplicate_fact_id', message: `Duplicate fact id: ${fact.id}`, path })
    }
    ids.add(fact.id)
    if (typeof fact.value === 'number' && !Number.isFinite(fact.value)) {
      issues.push({ level: 'error', code: 'non_finite_value', message: `Fact ${fact.id} value is not finite`, path })
    }
    if (!fact.series_id.includes('.') && !fact.series_id.includes(':') && !/^[A-Z0-9_./-]+$/i.test(fact.series_id)) {
      issues.push({
        level: 'warning',
        code: 'series_id_shape',
        message: `Fact ${fact.id} series_id looks unstructured: ${fact.series_id}`,
        path,
      })
    }
  }
  for (const [i, fact] of doc.facts.entries()) {
    if (fact.kind !== 'derived') continue
    const path = `facts[${i}]`
    if (!fact.derived_from?.length) {
      issues.push({
        level: 'error',
        code: 'derived_missing_parents',
        message: `Derived fact ${fact.id} needs derived_from`,
        path,
      })
      continue
    }
    for (const parent of fact.derived_from) {
      if (!ids.has(parent)) {
        issues.push({
          level: 'error',
          code: 'derived_parent_missing',
          message: `Derived fact ${fact.id} references missing parent ${parent}`,
          path,
        })
      }
    }
    if (!fact.caliber.startsWith('derived:')) {
      issues.push({
        level: 'warning',
        code: 'derived_caliber',
        message: `Derived fact ${fact.id} caliber should start with derived:`,
        path,
      })
    }
  }
  return issues
}

function validateJudgmentsInternal(
  doc: JudgmentsDocument,
  factsById: Map<string, Fact>,
): BriefIssue[] {
  const issues: BriefIssue[] = []
  const jids = new Set<string>()
  for (const [i, j] of doc.judgments.entries()) {
    const path = `judgments[${i}]`
    if (jids.has(j.id)) {
      issues.push({ level: 'error', code: 'duplicate_judgment_id', message: `Duplicate judgment id: ${j.id}`, path })
    }
    jids.add(j.id)

    if (j.evidence_ids.length === 0) {
      issues.push({ level: 'error', code: 'empty_evidence', message: `Judgment ${j.id} has no evidence_ids`, path })
    }
    for (const eid of j.evidence_ids) {
      if (!factsById.has(eid)) {
        issues.push({
          level: 'error',
          code: 'evidence_missing',
          message: `Judgment ${j.id} evidence_id ${eid} not in facts`,
          path,
        })
      }
    }

    if (EVIDENCE_TRIGGER.test(j.claim) && j.evidence_ids.length < 1) {
      issues.push({
        level: 'error',
        code: 'trigger_without_evidence',
        message: `Judgment ${j.id} uses evidence-gated language but has no evidence_ids`,
        path,
      })
    }

    if (j.kind === 'hypothesis' && j.confidence === 'high') {
      issues.push({
        level: 'warning',
        code: 'hypothesis_high_confidence',
        message: `Hypothesis ${j.id} marked high confidence — prefer medium/low or promote to judgment with stronger evidence`,
        path,
      })
    }

    const evidenceDays = j.evidence_ids
      .map((id) => factsById.get(id))
      .filter((f): f is Fact => Boolean(f))
      .map((f) => dayKey(f.asof))
      .filter((d): d is string => Boolean(d))
      .sort()
    if (evidenceDays.length >= 2) {
      const span = daysBetween(evidenceDays[0]!, evidenceDays[evidenceDays.length - 1]!)
      if (span > 1) {
        issues.push({
          level: 'warning',
          code: 'time_misalignment',
          message: `Judgment ${j.id} evidence asof spans ${span} days (${evidenceDays[0]} … ${evidenceDays[evidenceDays.length - 1]}) — do not imply same-session causality without labeling`,
          path,
        })
      }
    }
  }

  if (doc.judgments.length > 3) {
    issues.push({
      level: 'error',
      code: 'too_many_judgments',
      message: `At most 3 judgments allowed (got ${doc.judgments.length})`,
    })
  }

  return issues
}

export function validateFactsDocument(input: unknown): BriefValidateResult {
  const parsed = FactsDocumentSchema.safeParse(input)
  if (!parsed.success) {
    const errors: BriefIssue[] = parsed.error.issues.map((issue) => ({
      level: 'error' as const,
      code: 'schema',
      message: issue.message,
      path: issue.path.join('.') || undefined,
    }))
    return { ok: false, errors, warnings: [], asof_span_days: null, fact_ids: [] }
  }

  const structural = validateFactsInternal(parsed.data)
  const { spanDays, warnings: asofWarnings } = collectAsofSpan(parsed.data.facts)
  const errors = structural.filter((i) => i.level === 'error')
  const warnings = [...structural.filter((i) => i.level === 'warning'), ...asofWarnings]
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    asof_span_days: spanDays,
    fact_ids: parsed.data.facts.map((f) => f.id),
  }
}

export function validateJudgmentsDocument(
  judgmentsInput: unknown,
  factsInput: unknown,
): BriefValidateResult {
  const facts = FactsDocumentSchema.safeParse(factsInput)
  const judgments = JudgmentsDocumentSchema.safeParse(judgmentsInput)
  const errors: BriefIssue[] = []
  const warnings: BriefIssue[] = []

  if (!facts.success) {
    for (const issue of facts.error.issues) {
      errors.push({ level: 'error', code: 'facts_schema', message: issue.message, path: issue.path.join('.') || undefined })
    }
  }
  if (!judgments.success) {
    for (const issue of judgments.error.issues) {
      errors.push({
        level: 'error',
        code: 'judgments_schema',
        message: issue.message,
        path: issue.path.join('.') || undefined,
      })
    }
  }
  if (!facts.success || !judgments.success) {
    return { ok: false, errors, warnings, asof_span_days: null, fact_ids: [] }
  }

  const factResult = validateFactsDocument(facts.data)
  errors.push(...factResult.errors)
  warnings.push(...factResult.warnings)

  const factsById = new Map(facts.data.facts.map((f) => [f.id, f]))
  const jIssues = validateJudgmentsInternal(judgments.data, factsById)
  errors.push(...jIssues.filter((i) => i.level === 'error'))
  warnings.push(...jIssues.filter((i) => i.level === 'warning'))

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    asof_span_days: factResult.asof_span_days,
    fact_ids: factResult.fact_ids,
  }
}

export function assertNoOrphanNumbersInProse(prose: string, facts: Fact[]): BriefIssue[] {
  const issues: BriefIssue[] = []
  const allowed = new Set(
    facts.flatMap((f) => {
      const v = typeof f.value === 'number' ? String(f.value) : f.value
      const variants = [v]
      if (typeof f.value === 'number') {
        variants.push(f.value.toFixed(1), f.value.toFixed(2), String(Math.round(f.value)))
      }
      return variants
    }),
  )
  const re = /(?<![A-Za-z0-9_.])(-?\d+(?:\.\d+)?)(\s*(?:bp|bps|%|pct))?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(prose)) !== null) {
    const raw = m[1]!
    const withUnit = m[2] ? `${raw}${m[2].replace(/\s+/g, '')}` : raw
    if (allowed.has(raw) || allowed.has(withUnit)) continue
    if (/^(19|20)\d{2}$/.test(raw)) continue
    if (raw.length <= 1) continue
    issues.push({
      level: 'warning',
      code: 'orphan_number',
      message: `Number ${m[0].trim()} in prose not found among fact values`,
    })
  }
  return issues
}

export type { Judgment }
