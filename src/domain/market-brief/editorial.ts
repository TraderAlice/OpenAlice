/**
 * Editorial Layer validator — compare edited prose against Analysis/facts source.
 * Does not rewrite; only flags number / unit / date / uncertainty drift.
 */

import type { AnalysisDocument, Certainty, Fact } from './schema.js'
import { CERTAINTY_RANK } from './schema.js'
import type { BriefIssue } from './validate.js'

export type EditorialTokenBag = {
  numbers: string[]
  dates: string[]
  units: Array<{ number: string; unit: string }>
  hedges: string[]
  strongClaims: string[]
}

const NUMBER_RE = /(?<![A-Za-z0-9_.])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g
const UNIT_PAIR_RE =
  /(-?\d+(?:\.\d+)?)\s*(bp|bps|%|pct|％|亿元|万亿元|亿美元|美元|人民币|元)/gi

const HEDGE_RE =
  /可能|或许|一种解释|一个可能|尚无法|尚不能|尚不足以|待验证|初步来看|仍需观察|推测|或许|未确认|没有足够证据|may |might |possibly |unclear|unconfirmed|hypothesis/gi

const STRONG_RE =
  /必然|毫无疑问|就是因为|唯一原因|已经确认|可以确认|推动了|导致了|市场已经在定价|一定会|彻底|must |definitely |proves that|caused by/gi

const UNCERTAINTY_DOWNGRADE: Array<{ from: RegExp; to: RegExp; code: string; level: 'error' | 'warning' }> = [
  {
    from: /尚无法确认|尚不能确认|没有足够证据|只是推测|待验证/,
    to: /可以确认|已经确认|证明了|就是因为/,
    code: 'uncertainty_collapsed',
    level: 'error',
  },
  {
    from: /可能与|或许与|可能反映/,
    to: /推动了|导致了|造成了|与.+有关(?!，但)/,
    code: 'hedge_to_causal',
    level: 'error',
  },
]

export function extractEditorialTokens(text: string): EditorialTokenBag {
  const numbers = [...text.matchAll(NUMBER_RE)].map((m) => m[1]!).filter((n) => !/^(19|20)\d{2}$/.test(n))
  const dates = [...text.matchAll(DATE_RE)].map((m) => m[0]!)
  const units: Array<{ number: string; unit: string }> = []
  for (const m of text.matchAll(UNIT_PAIR_RE)) {
    units.push({ number: m[1]!, unit: m[2]!.toLowerCase().replace('％', '%').replace('bps', 'bp') })
  }
  const hedges = [...text.matchAll(HEDGE_RE)].map((m) => m[0]!)
  const strongClaims = [...text.matchAll(STRONG_RE)].map((m) => m[0]!)
  return { numbers, dates, units, hedges, strongClaims }
}

function factNumberStrings(facts: Fact[]): Set<string> {
  const out = new Set<string>()
  for (const f of facts) {
    const raw = typeof f.value === 'number' ? String(f.value) : f.value
    out.add(raw)
    if (typeof f.value === 'number') {
      out.add(f.value.toFixed(1))
      out.add(f.value.toFixed(2))
      out.add(String(Math.round(f.value)))
    }
    const day = f.asof.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    if (day) {
      out.add(day)
      const [, mo, d] = day.split('-')
      if (mo && d) out.add(`${Number(mo)}/${Number(d)}`)
    }
  }
  return out
}

function sourceUnitPairs(facts: Fact[], sourceText: string): Array<{ number: string; unit: string }> {
  const fromText = extractEditorialTokens(sourceText).units
  const fromFacts: Array<{ number: string; unit: string }> = []
  for (const f of facts) {
    if (!f.unit) continue
    const n = typeof f.value === 'number' ? String(f.value) : f.value
    const unit = f.unit.toLowerCase().replace('bps', 'bp').replace('％', '%')
    fromFacts.push({ number: n, unit })
  }
  return [...fromFacts, ...fromText]
}

function analysisSourceText(doc: AnalysisDocument): string {
  const parts: string[] = [doc.asof]
  for (const f of doc.facts) {
    parts.push(String(f.value), f.asof, f.unit ?? '', f.series_id)
  }
  for (const s of doc.signals) {
    parts.push(s.title, s.conclusion, ...(s.watch_points ?? []))
    for (const c of [...s.interpretation, ...s.hypotheses]) parts.push(c.text)
  }
  for (const g of doc.data_limitations) parts.push(g)
  return parts.join('\n')
}

export type EditorialValidateResult = {
  ok: boolean
  errors: BriefIssue[]
  warnings: BriefIssue[]
  source_tokens: EditorialTokenBag
  edited_tokens: EditorialTokenBag
}

/**
 * Validate that edited markdown preserves Analysis Layer semantics.
 * @param source Analysis document (preferred) OR concatenated source prose
 * @param edited Edited report markdown
 */
export function validateEditorial(opts: {
  analysis?: AnalysisDocument
  sourceProse?: string
  edited: string
  /** When set, also require these data_limitation strings to still appear (substring). */
  requireLimitations?: string[]
}): EditorialValidateResult {
  const errors: BriefIssue[] = []
  const warnings: BriefIssue[] = []

  const facts = opts.analysis?.facts ?? []
  const sourceText = opts.analysis ? analysisSourceText(opts.analysis) : (opts.sourceProse ?? '')
  if (!sourceText.trim()) {
    errors.push({ level: 'error', code: 'missing_source', message: 'Editorial validate needs analysis or sourceProse' })
    return {
      ok: false,
      errors,
      warnings,
      source_tokens: extractEditorialTokens(''),
      edited_tokens: extractEditorialTokens(opts.edited),
    }
  }

  const sourceTok = extractEditorialTokens(sourceText)
  const editedTok = extractEditorialTokens(opts.edited)
  const allowedNumbers = factNumberStrings(facts)
  for (const n of sourceTok.numbers) allowedNumbers.add(n)

  // Numbers in edited that look like market figures should exist in source/facts
  for (const n of editedTok.numbers) {
    if (n.length <= 1) continue
    if (allowedNumbers.has(n)) continue
    // Allow integers that appear only as list indices / signal numbers 1-3
    if (/^[1-3]$/.test(n)) continue
    warnings.push({
      level: 'warning',
      code: 'orphan_edited_number',
      message: `Edited prose number ${n} not found in Analysis Layer facts/source`,
    })
  }

  // Unit flip: same number with different unit class (% vs bp)
  const sourceUnits = sourceUnitPairs(facts, sourceText)
  for (const e of editedTok.units) {
    const matches = sourceUnits.filter((s) => s.number === e.number || Number(s.number) === Number(e.number))
    if (!matches.length) continue
    const okUnit = matches.some((s) => normalizeUnit(s.unit) === normalizeUnit(e.unit))
    if (!okUnit) {
      errors.push({
        level: 'error',
        code: 'unit_flip',
        message: `Number ${e.number} unit changed to ${e.unit} (source had ${matches.map((m) => m.unit).join('/')})`,
      })
    }
  }

  // Dates in source should not disappear when they look like asof keys (lenient: warn)
  const editedDates = new Set(editedTok.dates)
  const sourceDays = facts
    .map((f) => f.asof.match(/^(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter((d): d is string => Boolean(d))
  for (const day of [...new Set(sourceDays)]) {
    const compact = day.replace(/-/g, '/')
    const short = `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`
    if (opts.edited.includes(day) || editedDates.has(day) || opts.edited.includes(short) || opts.edited.includes(compact)) {
      continue
    }
    // Only warn if the date appeared in signal text (not every fact asof must be in prose)
  }

  // Uncertainty collapse heuristics on full edited body vs source hedges
  for (const rule of UNCERTAINTY_DOWNGRADE) {
    if (rule.from.test(sourceText) && rule.to.test(opts.edited) && !rule.from.test(opts.edited)) {
      errors.push({
        level: rule.level,
        code: rule.code,
        message: `Edited prose appears to strengthen certainty beyond Analysis Layer hedges (${rule.code})`,
      })
    }
  }

  if (sourceTok.hedges.length > 0 && editedTok.hedges.length === 0 && /interpretation|hypothesis|可能|或许/.test(sourceText)) {
    warnings.push({
      level: 'warning',
      code: 'hedges_removed',
      message: 'Source used hedge language but edited prose has none',
    })
  }

  if (editedTok.strongClaims.length > sourceTok.strongClaims.length + 1) {
    warnings.push({
      level: 'warning',
      code: 'strong_language_added',
      message: `Edited prose adds strong claims (${editedTok.strongClaims.join(', ')}) not present in source`,
    })
  }

  // Per-signal certainty: hypothesis/forecast must keep hedges in edited if conclusion is echoed
  if (opts.analysis) {
    for (const s of opts.analysis.signals) {
      if (s.certainty === 'hypothesis' || s.certainty === 'forecast') {
        const snippet = s.conclusion.slice(0, 12)
        if (snippet && opts.edited.includes(snippet) && !HEDGE_RE.test(opts.edited)) {
          warnings.push({
            level: 'warning',
            code: 'signal_certainty_unhedged',
            message: `Signal ${s.id} (${s.certainty}) appears in edited prose without hedge markers`,
          })
        }
      }
      for (const claim of s.hypotheses) {
        checkClaimUpgrade(claim.certainty, claim.text, opts.edited, errors, warnings)
      }
    }
  }

  const limitations = opts.requireLimitations ?? opts.analysis?.data_limitations ?? []
  for (const lim of limitations) {
    const key = lim.trim().slice(0, 16)
    if (key && !opts.edited.includes(key) && !opts.edited.includes(lim.trim())) {
      errors.push({
        level: 'error',
        code: 'limitation_dropped',
        message: `Data limitation missing from edited prose: ${lim.slice(0, 80)}`,
      })
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    source_tokens: sourceTok,
    edited_tokens: editedTok,
  }
}

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase()
  if (u === 'bps' || u === 'bp') return 'bp'
  if (u === 'pct' || u === '%' || u === '％') return '%'
  return u
}

function checkClaimUpgrade(
  certainty: Certainty,
  text: string,
  edited: string,
  errors: BriefIssue[],
  warnings: BriefIssue[],
): void {
  const snippet = text.slice(0, 20)
  if (!snippet || !edited.includes(snippet.slice(0, 10))) return
  // If hypothesis text appears but surrounding edited context uses strong causal verbs
  if (certainty === 'hypothesis' && /推动了|导致了|就是因为/.test(edited)) {
    errors.push({
      level: 'error',
      code: 'hypothesis_upgraded',
      message: `Hypothesis text appears near causal language in edited prose (certainty rank ${CERTAINTY_RANK[certainty]})`,
    })
  } else if (certainty === 'interpretation' && /毫无疑问|必然/.test(edited)) {
    warnings.push({
      level: 'warning',
      code: 'interpretation_overstated',
      message: 'Interpretation appears near over-strong language in edited prose',
    })
  }
}

/** Length budgets (Chinese characters, soft). */
export const EDITORIAL_LENGTH_BUDGET = {
  executive_summary: { min: 150, max: 280 },
  signal_body: { min: 120, max: 320 },
  data_limitations: { min: 40, max: 220 },
} as const

export function checkLengthBudgets(markdown: string): BriefIssue[] {
  const warnings: BriefIssue[] = []
  const exec = markdown.match(/##\s*(今天最重要的三个变化|Executive Summary)([\s\S]*?)(?=\n##\s)/)
  if (exec) {
    const len = exec[2]!.replace(/\s+/g, '').length
    if (len > EDITORIAL_LENGTH_BUDGET.executive_summary.max) {
      warnings.push({
        level: 'warning',
        code: 'exec_summary_long',
        message: `Executive summary ~${len} chars exceeds soft budget ${EDITORIAL_LENGTH_BUDGET.executive_summary.max}`,
      })
    }
  }
  return warnings
}
