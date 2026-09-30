/**
 * Render a write-once report.md skeleton from validated facts + judgments.
 * Agents may polish wording, but numbers and evidence ids stay machine-sourced.
 */

import type { AnalysisDocument, Fact, FactsDocument, Judgment, JudgmentsDocument } from './schema.js'
import { validateAnalysisDocument } from './analysis.js'
import { validateJudgmentsDocument, type BriefIssue, type BriefValidateResult } from './validate.js'

function dayKey(asof: string): string | null {
  const m = asof.match(/^(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? null
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`))
  return Math.round(ms / 86_400_000)
}

export type JudgmentAsofSpan = {
  judgment_id: string
  span_days: number
  asof_min: string
  asof_max: string
  time_misalignment: boolean
}

export function judgmentEvidenceAsofSpans(
  judgments: Judgment[],
  factsById: Map<string, Fact>,
): JudgmentAsofSpan[] {
  return judgments.map((j) => {
    const days = j.evidence_ids
      .map((id) => factsById.get(id))
      .filter((f): f is Fact => Boolean(f))
      .map((f) => dayKey(f.asof))
      .filter((d): d is string => Boolean(d))
      .sort()
    if (days.length === 0) {
      return {
        judgment_id: j.id,
        span_days: 0,
        asof_min: '',
        asof_max: '',
        time_misalignment: false,
      }
    }
    const asof_min = days[0]!
    const asof_max = days[days.length - 1]!
    const span_days = daysBetween(asof_min, asof_max)
    return {
      judgment_id: j.id,
      span_days,
      asof_min,
      asof_max,
      time_misalignment: span_days > 1,
    }
  })
}

function formatValue(fact: Fact): string {
  const unit = fact.unit ? ` ${fact.unit}` : ''
  return `${fact.value}${unit}`
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export type RenderBriefOptions = {
  title?: string
  gaps?: string[]
  /** Extra prose under judgments (agent narrative). Still scanned for orphans by validate. */
  narrative?: string
  locale?: 'zh' | 'en'
}

export type RenderBriefResult = {
  ok: boolean
  markdown: string
  validation: BriefValidateResult
  time_misalignments: JudgmentAsofSpan[]
}

export function renderBriefMarkdown(
  facts: FactsDocument,
  judgments: JudgmentsDocument,
  opts: RenderBriefOptions = {},
): RenderBriefResult {
  const validation = validateJudgmentsDocument(judgments, facts)
  const factsById = new Map(facts.facts.map((f) => [f.id, f]))
  const spans = judgmentEvidenceAsofSpans(judgments.judgments, factsById)
  const locale = opts.locale ?? 'zh'
  const title =
    opts.title ??
    (locale === 'zh' ? '今日宏观 · 跨资产' : 'Cross-asset market brief')

  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push('')
  if (facts.focus_markets?.length) {
    lines.push(
      locale === 'zh'
        ? `**关注市场：** ${facts.focus_markets.join(', ')}`
        : `**Focus markets:** ${facts.focus_markets.join(', ')}`,
    )
    lines.push('')
  }

  lines.push(locale === 'zh' ? '## 数据截至' : '## Data as-of')
  lines.push('')
  lines.push(
    locale === 'zh'
      ? '| series_id | asof | source | caliber | value | id |'
      : '| series_id | asof | source | caliber | value | id |',
  )
  lines.push('|---|---|---|---|---|---|')
  for (const f of facts.facts) {
    lines.push(
      `| ${escapeCell(f.series_id)} | ${escapeCell(f.asof)} | ${escapeCell(f.source)} | ${escapeCell(f.caliber)} | ${escapeCell(formatValue(f))} | \`${f.id}\` |`,
    )
  }
  lines.push('')

  const observed = facts.facts.filter((f) => f.kind !== 'derived')
  const derived = facts.facts.filter((f) => f.kind === 'derived')

  lines.push(locale === 'zh' ? '## 事实（observed）' : '## Facts (observed)')
  lines.push('')
  for (const f of observed) {
    lines.push(`- \`${f.id}\` — **${formatValue(f)}** · ${f.series_id} · ${f.source} · asof ${f.asof}`)
    if (f.note) lines.push(`  - ${f.note}`)
  }
  if (!observed.length) lines.push(locale === 'zh' ? '- （无）' : '- (none)')
  lines.push('')

  if (derived.length) {
    lines.push(locale === 'zh' ? '## 派生（code-derived）' : '## Derived (code)')
    lines.push('')
    for (const f of derived) {
      const parents = (f.derived_from ?? []).map((id) => `\`${id}\``).join(', ')
      lines.push(
        `- \`${f.id}\` — **${formatValue(f)}** · from ${parents || '?'} · \`${f.caliber}\` · asof ${f.asof}`,
      )
    }
    lines.push('')
  }

  lines.push(locale === 'zh' ? '## 判断（≤3）' : '## Judgments (≤3)')
  lines.push('')
  for (const [i, j] of judgments.judgments.entries()) {
    const span = spans.find((s) => s.judgment_id === j.id)
    const badge =
      span?.time_misalignment
        ? locale === 'zh'
          ? ` **〔时间错位：证据 asof ${span.asof_min} … ${span.asof_max}，跨 ${span.span_days} 日〕**`
          : ` **〔time misalignment: evidence asof ${span.asof_min} … ${span.asof_max}, ${span.span_days}d〕**`
        : ''
    lines.push(`### ${i + 1}. ${j.claim}${badge}`)
    lines.push('')
    lines.push(
      locale === 'zh'
        ? `- **置信度：** ${j.confidence} · **视界：** ${j.horizon} · **类型：** ${j.kind}`
        : `- **Confidence:** ${j.confidence} · **Horizon:** ${j.horizon} · **Kind:** ${j.kind}`,
    )
    lines.push(
      locale === 'zh'
        ? `- **证据 ids：** ${j.evidence_ids.map((id) => `\`${id}\``).join(', ')}`
        : `- **Evidence ids:** ${j.evidence_ids.map((id) => `\`${id}\``).join(', ')}`,
    )
    for (const eid of j.evidence_ids) {
      const f = factsById.get(eid)
      if (f) {
        lines.push(`  - \`${eid}\`: ${formatValue(f)} (${f.source}, asof ${f.asof})`)
      }
    }
    lines.push(
      locale === 'zh' ? `- **证伪：** ${j.falsifier}` : `- **Falsifier:** ${j.falsifier}`,
    )
    lines.push('')
  }
  if (!judgments.judgments.length) {
    lines.push(locale === 'zh' ? '（尚无判断）' : '(no judgments)')
    lines.push('')
  }

  if (opts.narrative?.trim()) {
    lines.push(locale === 'zh' ? '## 叙述' : '## Narrative')
    lines.push('')
    lines.push(opts.narrative.trim())
    lines.push('')
  }

  const gaps = opts.gaps?.filter((g) => g.trim()) ?? []
  lines.push(locale === 'zh' ? '## 数据缺口' : '## Gaps')
  lines.push('')
  if (gaps.length) {
    for (const g of gaps) lines.push(`- ${g}`)
  } else {
    lines.push(locale === 'zh' ? '- （无显式缺口）' : '- (none listed)')
  }
  lines.push('')

  if (!validation.ok || validation.warnings.length) {
    lines.push(locale === 'zh' ? '## 校验备注' : '## Validation notes')
    lines.push('')
    for (const issue of [...validation.errors, ...validation.warnings] as BriefIssue[]) {
      lines.push(`- **${issue.level}/${issue.code}:** ${issue.message}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push(
    locale === 'zh'
      ? '_本报告由 `alice brief render` 从 facts/judgments 生成；数字勿手改，覆盖用新 runId + `--output`。_'
      : '_Generated by `alice brief render` from facts/judgments; do not hand-edit numbers; use a new runId + `--output` to publish again._',
  )
  lines.push('')

  return {
    ok: validation.ok,
    markdown: lines.join('\n'),
    validation,
    time_misalignments: spans.filter((s) => s.time_misalignment),
  }
}

export type RenderAnalysisResult = {
  ok: boolean
  markdown: string
  validation: BriefValidateResult & { signal_ids: string[] }
}

/**
 * Two-layer report from AnalysisDocument: Executive Summary + Detailed signals.
 * Editorial Pass may polish wording afterward; run `alice brief editorial-check` before publish.
 */
export function renderAnalysisMarkdown(
  analysis: AnalysisDocument,
  opts: { title?: string; locale?: 'zh' | 'en' } = {},
): RenderAnalysisResult {
  const validation = validateAnalysisDocument(analysis)
  const locale = opts.locale ?? 'zh'
  const title =
    opts.title ??
    (locale === 'zh' ? '跨资产简报' : 'Cross-asset brief')
  const factsById = new Map(analysis.facts.map((f) => [f.id, f]))
  const lines: string[] = []

  lines.push(`# ${title}`)
  lines.push('')
  lines.push(locale === 'zh' ? `**截至：** ${analysis.asof}` : `**As of:** ${analysis.asof}`)
  if (analysis.focus_markets?.length) {
    lines.push(
      locale === 'zh'
        ? `**关注市场：** ${analysis.focus_markets.join(', ')}`
        : `**Focus markets:** ${analysis.focus_markets.join(', ')}`,
    )
  }
  lines.push('')

  // —— Layer 1: Executive Summary ——
  lines.push(locale === 'zh' ? '## 今天最重要的三个变化' : '## Executive Summary')
  lines.push('')
  for (const [i, s] of analysis.signals.entries()) {
    const cert =
      locale === 'zh'
        ? `〔${certaintyLabelZh(s.certainty)}〕`
        : `〔${s.certainty}〕`
    lines.push(`**${i + 1}. ${s.title}** ${cert}`)
    lines.push('')
    lines.push(s.conclusion)
    lines.push('')
  }

  // —— Layer 2: Detailed ——
  lines.push(locale === 'zh' ? '## 详细分析' : '## Detailed Analysis')
  lines.push('')

  lines.push(locale === 'zh' ? '### 数据截至' : '### Data as-of')
  lines.push('')
  lines.push('| series_id | asof | source | caliber | value | id |')
  lines.push('|---|---|---|---|---|---|')
  for (const f of analysis.facts) {
    lines.push(
      `| ${escapeCell(f.series_id)} | ${escapeCell(f.asof)} | ${escapeCell(f.source)} | ${escapeCell(f.caliber)} | ${escapeCell(formatValue(f))} | \`${f.id}\` |`,
    )
  }
  lines.push('')

  for (const [i, s] of analysis.signals.entries()) {
    lines.push(`### ${locale === 'zh' ? '信号' : 'Signal'} ${i + 1}. ${s.title}`)
    lines.push('')
    lines.push(
      locale === 'zh'
        ? `**核心判断** 〔${certaintyLabelZh(s.certainty)} / ${s.confidence}〕：${s.conclusion}`
        : `**Conclusion** 〔${s.certainty} / ${s.confidence}〕: ${s.conclusion}`,
    )
    lines.push('')
    lines.push(locale === 'zh' ? '**关键证据：**' : '**Evidence:**')
    for (const eid of s.evidence_ids) {
      const f = factsById.get(eid)
      if (f) {
        lines.push(`- \`${eid}\`: **${formatValue(f)}** · ${f.source} · asof ${f.asof} · ${f.series_id}`)
      } else {
        lines.push(`- \`${eid}\`: _(missing)_`)
      }
    }
    lines.push('')

    if (s.interpretation.length) {
      lines.push(locale === 'zh' ? '**解读：**' : '**Interpretation:**')
      for (const c of s.interpretation) {
        lines.push(`- 〔${certaintyLabelZh(c.certainty)}〕 ${c.text}`)
      }
      lines.push('')
    }
    if (s.hypotheses.length) {
      lines.push(locale === 'zh' ? '**推测（待验证）：**' : '**Hypotheses:**')
      for (const c of s.hypotheses) {
        lines.push(`- 〔${certaintyLabelZh(c.certainty)}〕 ${c.text}`)
      }
      lines.push('')
    }
    if (s.watch_points.length) {
      lines.push(locale === 'zh' ? '**接下来观察：**' : '**Watch:**')
      for (const w of s.watch_points) lines.push(`- ${w}`)
      lines.push('')
    }
    if (s.falsifier) {
      lines.push(locale === 'zh' ? `- **证伪：** ${s.falsifier}` : `- **Falsifier:** ${s.falsifier}`)
      lines.push('')
    }
  }

  lines.push(locale === 'zh' ? '## 数据限制' : '## Data Limitations')
  lines.push('')
  if (analysis.data_limitations.length) {
    for (const g of analysis.data_limitations) lines.push(`- ${g}`)
  } else {
    lines.push(locale === 'zh' ? '- （无显式缺口）' : '- (none listed)')
  }
  lines.push('')

  if (!validation.ok || validation.warnings.length) {
    lines.push(locale === 'zh' ? '## 校验备注' : '## Validation notes')
    lines.push('')
    for (const issue of [...validation.errors, ...validation.warnings]) {
      lines.push(`- **${issue.level}/${issue.code}:** ${issue.message}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push(
    locale === 'zh'
      ? '_Analysis Layer 输出（`alice brief render-analysis`）。编辑润色后须跑 `alice brief editorial-check`；Semantic fidelity > elegance。_'
      : '_Analysis Layer output (`alice brief render-analysis`). After editorial polish run `alice brief editorial-check`; semantic fidelity > elegance._',
  )
  lines.push('')

  return { ok: validation.ok, markdown: lines.join('\n'), validation }
}

function certaintyLabelZh(c: string): string {
  switch (c) {
    case 'fact':
      return '事实'
    case 'derived_fact':
      return '派生事实'
    case 'interpretation':
      return '解读'
    case 'hypothesis':
      return '推测'
    case 'forecast':
      return '预测'
    case 'data_limitation':
      return '数据限制'
    default:
      return c
  }
}
