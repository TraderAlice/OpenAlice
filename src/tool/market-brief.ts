/**
 * Market-brief structural tools — schema / path / assemble / derive / validate / render.
 * Fetch stays in traderhub + market-data; judgment stays with the agent.
 * Persist via CLI `--output` (write-once / wx).
 */

import { tool } from 'ai'
import { z } from 'zod'
import {
  AnalysisDocumentSchema,
  DeriveOpSchema,
  FactsDocumentSchema,
  JudgmentsDocumentSchema,
  MarketSignalSchema,
  ObservationInputSchema,
  assembleFacts,
  briefWriteOnceContract,
  buildAnalysisDocument,
  checkLengthBudgets,
  deriveFacts,
  renderAnalysisMarkdown,
  renderBriefMarkdown,
  suggestBriefPath,
  validateAnalysisDocument,
  validateEditorial,
  validateFactsDocument,
  validateJudgmentsDocument,
  assertNoOrphanNumbersInProse,
  type AnalysisDocument,
  type BriefArtifactKind,
  type DeriveOp,
  type FactsDocument,
  type JudgmentsDocument,
  type MarketSignal,
  type ObservationInput,
} from '@/domain/market-brief/index.js'

function parseJsonObject<T>(raw: string, label: string): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  return parsed as T
}

function resolveFacts(facts?: FactsDocument, factsJson?: string): FactsDocument {
  if (facts && factsJson) throw new Error('Pass either facts or factsJson, not both')
  if (facts) return FactsDocumentSchema.parse(facts)
  if (factsJson) return FactsDocumentSchema.parse(parseJsonObject(factsJson, 'factsJson'))
  throw new Error('facts or factsJson is required')
}

function resolveJudgments(judgments?: JudgmentsDocument, judgmentsJson?: string): JudgmentsDocument {
  if (judgments && judgmentsJson) throw new Error('Pass either judgments or judgmentsJson, not both')
  if (judgments) return JudgmentsDocumentSchema.parse(judgments)
  if (judgmentsJson) return JudgmentsDocumentSchema.parse(parseJsonObject(judgmentsJson, 'judgmentsJson'))
  throw new Error('judgments or judgmentsJson is required')
}

function resolveOps(ops?: DeriveOp[], opsJson?: string): DeriveOp[] {
  if (ops && opsJson) throw new Error('Pass either ops or opsJson, not both')
  const raw = ops ?? (opsJson ? parseJsonObject<unknown>(opsJson, 'opsJson') : null)
  if (!raw) throw new Error('ops or opsJson is required')
  if (!Array.isArray(raw)) throw new Error('ops must be an array')
  return raw.map((op) => DeriveOpSchema.parse(op))
}

function resolveObservations(
  observations?: ObservationInput[],
  observationsJson?: string,
): ObservationInput[] {
  if (observations && observationsJson) throw new Error('Pass either observations or observationsJson, not both')
  const raw = observations ?? (observationsJson ? parseJsonObject<unknown>(observationsJson, 'observationsJson') : null)
  if (!raw) throw new Error('observations or observationsJson is required')
  if (!Array.isArray(raw)) throw new Error('observations must be an array')
  return raw.map((row) => ObservationInputSchema.parse(row) as ObservationInput)
}

export function createMarketBriefTools() {
  return {
    briefSchema: tool({
      description: `Return the market-brief facts/judgments JSON schemas, an empty facts template, and the write-once path contract.

Use before authoring \`research/briefs/<date>/<run>/facts.json\`. Numbers in the final brief must come from facts (observed or \`alice brief derive\`), not hand arithmetic in prose.`,
      inputSchema: z.object({}).meta({ examples: [{}] }),
      execute: () => ({
        version: 1,
        write_once: briefWriteOnceContract(),
        empty_facts: {
          version: 1 as const,
          focus_markets: [] as string[],
          facts: [] as unknown[],
        },
        empty_judgments: {
          version: 1 as const,
          judgments: [] as unknown[],
        },
        fact_fields: [
          'id',
          'series_id',
          'value',
          'unit?',
          'asof',
          'source',
          'caliber',
          'fetched_at',
          'kind: observed|derived',
          'derived_from?',
          'data_type?: official_close|exchange_day_end|intraday|settlement|session_close_utc|release|event|calendar|proxy|derived|unknown',
          'quality?: A|B|C',
          'domain?: market|flow|macro|event|calendar|derived',
          'is_proxy?',
          'proxy_for?',
          'source_symbol?',
        ],
        judgment_fields: [
          'id',
          'claim',
          'evidence_ids[]',
          'confidence',
          'falsifier',
          'horizon',
          'kind: judgment|hypothesis',
          'certainty?: fact|derived_fact|interpretation|hypothesis|forecast|data_limitation',
        ],
        signal_fields: [
          'id',
          'title',
          'conclusion',
          'certainty',
          'evidence_ids[]',
          'interpretation[]',
          'hypotheses[]',
          'watch_points[]',
          'confidence',
          'falsifier?',
        ],
        derive_ops: ['delta_bp', 'spread', 'pct_change'],
        pipeline: [
          '1. Fetch evidence (traderhub / market-data / CSI/CNI/NBS/FRED).',
          '2. alice brief assemble → facts.json',
          '3. alice brief derive → facts.derived.json',
          '4. alice brief build-analysis → analysis.json (signals + certainty)',
          '5. alice brief render-analysis → report.draft.md (exec + detail)',
          '6. Editorial polish (skill style guide) — do NOT mutate analysis.json',
          '7. alice brief editorial-check — then --output report.md',
        ],
        editorial_rule: 'Semantic fidelity > elegance. Editorial Layer must not upgrade certainty.',
      }),
    }),

    briefPath: tool({
      description: `Suggest a write-once Workspace-relative path under research/briefs/<asofDate>/<runId>/.

Kinds: facts | facts.derived | judgments | analysis | report | report.draft. Pair with CLI \`--output <path>\`.`,
      inputSchema: z
        .object({
          asofDate: z.string().min(1).describe('Session label YYYY-MM-DD'),
          runId: z.string().min(1).describe('Short run slug, e.g. evening or 2145'),
          kind: z
            .enum(['facts', 'facts.derived', 'judgments', 'analysis', 'report', 'report.draft'])
            .default('facts')
            .describe('Artifact kind'),
        })
        .meta({ examples: [{ asofDate: '2026-09-30', runId: 'evening', kind: 'analysis' }] }),
      execute: ({ asofDate, runId, kind }) => ({
        path: suggestBriefPath({ asofDate, runId, kind: kind as BriefArtifactKind }),
        write_once: briefWriteOnceContract(),
      }),
    }),

    briefAssemble: tool({
      description: `Lock fetched observations into a FactsDocument (kind=observed, shared fetched_at). Does not call vendors — pass rows you already pulled from CSI/CNI/FRED/boards.

Prefer CLI \`--observations-json-file\` + \`--output research/briefs/…/facts.json\`.`,
      inputSchema: z
        .object({
          focusMarkets: z.array(z.string().min(1)).optional().describe('Focus market ids'),
          observations: z.array(ObservationInputSchema).optional(),
          observationsJson: z.string().optional().describe('JSON array of observations; CLI --observations-json-file'),
          fetchedAt: z.string().optional().describe('ISO timestamp applied when a row omits fetched_at'),
        })
        .meta({
          examples: [
            {
              focusMarkets: ['cn-ashare', 'macro'],
              observationsJson:
                '[{"id":"csi300","series_id":"CSI:000300","value":1.2,"unit":"pct","asof":"2026-09-30","source":"CSI","caliber":"index-perf"}]',
            },
          ],
        }),
      execute: ({ focusMarkets, observations, observationsJson, fetchedAt }) => {
        try {
          const document = assembleFacts({
            ...(focusMarkets ? { focus_markets: focusMarkets } : {}),
            observations: resolveObservations(observations as ObservationInput[] | undefined, observationsJson),
            ...(fetchedAt ? { fetched_at: fetchedAt } : {}),
          })
          const validation = validateFactsDocument(document)
          return { ok: validation.ok, document, validation }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    briefDerive: tool({
      description: `Apply code-owned derive ops (delta_bp | spread | pct_change) onto a facts document. Do not hand-compute bp/%/spreads in prose.

Pass facts as object (\`facts\`) or JSON string (\`factsJson\` / CLI \`--facts-json-file\`). Same for ops (\`ops\` / \`opsJson\`). Persist with \`--output\` to facts.derived.json.`,
      inputSchema: z
        .object({
          facts: FactsDocumentSchema.optional().describe('FactsDocument object'),
          factsJson: z.string().optional().describe('FactsDocument as JSON string; use --facts-json-file from CLI'),
          ops: z.array(DeriveOpSchema).optional().describe('Derive operations'),
          opsJson: z.string().optional().describe('Derive ops as JSON array string; use --ops-json-file from CLI'),
        })
        .meta({
          examples: [
            {
              factsJson:
                '{"version":1,"facts":[{"id":"us10y_t0","series_id":"FRED:DGS10","value":4.2,"asof":"2026-09-29","source":"FRED","caliber":"fred_daily","fetched_at":"2026-09-30T12:00:00Z","kind":"observed"},{"id":"us10y_t1","series_id":"FRED:DGS10","value":4.35,"asof":"2026-09-30","source":"FRED","caliber":"fred_daily","fetched_at":"2026-09-30T12:00:00Z","kind":"observed"}]}',
              opsJson: '[{"op":"delta_bp","id":"us10y_d1_bp","from_id":"us10y_t0","to_id":"us10y_t1","scale":100}]',
            },
          ],
        }),
      execute: ({ facts, factsJson, ops, opsJson }) => {
        try {
          const doc = resolveFacts(facts, factsJson)
          const derived = deriveFacts(doc, resolveOps(ops, opsJson))
          const validation = validateFactsDocument(derived)
          return { ok: validation.ok, document: derived, validation }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    briefValidate: tool({
      description: `Validate a facts document and optional judgments + prose.

Checks: schema, duplicate ids, derived_from parents, evidence_ids resolve to facts, asof span, per-judgment time_misalignment, evidence-gated claim words, orphan numbers in prose (warning). Run before publishing report.md.`,
      inputSchema: z
        .object({
          facts: FactsDocumentSchema.optional(),
          factsJson: z.string().optional().describe('FactsDocument JSON; CLI --facts-json-file'),
          judgments: JudgmentsDocumentSchema.optional(),
          judgmentsJson: z.string().optional().describe('JudgmentsDocument JSON; CLI --judgments-json-file'),
          prose: z.string().optional().describe('Optional report markdown to scan for orphan numbers'),
        })
        .meta({
          examples: [
            {
              factsJson:
                '{"version":1,"facts":[{"id":"csi300","series_id":"CSI:000300","value":1.2,"unit":"pct","asof":"2026-09-30","source":"CSI","caliber":"index-perf","fetched_at":"2026-09-30T12:00:00Z","kind":"observed"}]}',
            },
          ],
        }),
      execute: ({ facts, factsJson, judgments, judgmentsJson, prose }) => {
        try {
          const factsDoc = resolveFacts(facts, factsJson)
          if (judgments || judgmentsJson) {
            const jDoc = resolveJudgments(judgments, judgmentsJson)
            const result = validateJudgmentsDocument(jDoc, factsDoc)
            const orphan = prose ? assertNoOrphanNumbersInProse(prose, factsDoc.facts) : []
            return {
              ...result,
              warnings: [...result.warnings, ...orphan],
              ok: result.ok,
            }
          }
          const result = validateFactsDocument(factsDoc)
          const orphan = prose ? assertNoOrphanNumbersInProse(prose, factsDoc.facts) : []
          return {
            ...result,
            warnings: [...result.warnings, ...orphan],
          }
        } catch (err) {
          return {
            ok: false as const,
            errors: [{ level: 'error' as const, code: 'parse', message: err instanceof Error ? err.message : String(err) }],
            warnings: [],
            asof_span_days: null,
            fact_ids: [] as string[],
          }
        }
      },
    }),

    briefRender: tool({
      description: `Render report.md from facts + judgments: as-of table, observed/derived sections, ≤3 judgments with evidence ids, time-misalignment badges, gaps.

Stdout is markdown — persist with \`--output …/report.md\` (wx). Refuses to invent numbers; validate errors still emit markdown but ok=false.`,
      inputSchema: z
        .object({
          facts: FactsDocumentSchema.optional(),
          factsJson: z.string().optional().describe('FactsDocument JSON; CLI --facts-json-file'),
          judgments: JudgmentsDocumentSchema.optional(),
          judgmentsJson: z.string().optional().describe('JudgmentsDocument JSON; CLI --judgments-json-file'),
          title: z.string().optional(),
          gaps: z.array(z.string()).optional().describe('Explicit data gaps'),
          gapsJson: z.string().optional().describe('JSON string array of gaps'),
          narrative: z.string().optional().describe('Optional prose under judgments (still orphan-scanned)'),
          locale: z.enum(['zh', 'en']).optional().describe('Report locale (default zh)'),
        })
        .meta({
          examples: [
            {
              factsJson:
                '{"version":1,"focus_markets":["macro"],"facts":[{"id":"us10y","series_id":"FRED:DGS10","value":4.35,"unit":"pct","asof":"2026-09-30","source":"FRED","caliber":"fred_daily","fetched_at":"2026-09-30T12:00:00Z","kind":"observed"}]}',
              judgmentsJson:
                '{"version":1,"judgments":[{"id":"j1","claim":"US10Y elevated vs recent print","evidence_ids":["us10y"],"confidence":"medium","falsifier":"US10Y falls >10bp next session","horizon":"1d","kind":"judgment"}]}',
            },
          ],
        }),
      execute: ({ facts, factsJson, judgments, judgmentsJson, title, gaps, gapsJson, narrative, locale }) => {
        const factsDoc = resolveFacts(facts, factsJson)
        const jDoc = resolveJudgments(judgments, judgmentsJson)
        let gapList = gaps
        if (gapsJson) {
          const parsed = parseJsonObject<unknown>(gapsJson, 'gapsJson')
          if (!Array.isArray(parsed) || !parsed.every((g) => typeof g === 'string')) {
            throw new Error('gapsJson must be a JSON string array')
          }
          gapList = parsed
        }
        const rendered = renderBriefMarkdown(factsDoc, jDoc, {
          ...(title ? { title } : {}),
          ...(gapList ? { gaps: gapList } : {}),
          ...(narrative ? { narrative } : {}),
          ...(locale ? { locale } : {}),
        })
        // Return markdown text so `alice brief render … --output report.md` writes
        // the report body (not a JSON envelope). Call `brief validate` for structured checks.
        const banner = `<!-- openalice-brief ok=${rendered.ok} time_misalignments=${rendered.time_misalignments.length} -->\n`
        return banner + rendered.markdown
      },
    }),

    briefBuildAnalysis: tool({
      description: `Build AnalysisDocument (facts + ≤3 MarketSignals with certainty grades). Prefer this over free-form judgments for Editorial Layer.

Pass facts + judgments (auto-mapped to signals) or explicit signalsJson. Persist with --output analysis.json.`,
      inputSchema: z
        .object({
          asof: z.string().min(1).describe('Session asof YYYY-MM-DD'),
          facts: FactsDocumentSchema.optional(),
          factsJson: z.string().optional(),
          judgments: JudgmentsDocumentSchema.optional(),
          judgmentsJson: z.string().optional(),
          signals: z.array(MarketSignalSchema).optional(),
          signalsJson: z.string().optional().describe('JSON MarketSignal[]; CLI --signals-json-file'),
          focusMarkets: z.array(z.string().min(1)).optional(),
          dataLimitations: z.array(z.string()).optional(),
          dataLimitationsJson: z.string().optional(),
        })
        .meta({
          examples: [
            {
              asof: '2026-09-30',
              factsJson:
                '{"version":1,"facts":[{"id":"us10y","series_id":"FRED:DGS10","value":4.35,"unit":"pct","asof":"2026-09-30","source":"FRED","caliber":"fred_daily","fetched_at":"2026-09-30T12:00:00Z","kind":"observed"}]}',
              judgmentsJson:
                '{"version":1,"judgments":[{"id":"j1","claim":"长端利率仍高，通胀预期并非唯一解释","evidence_ids":["us10y"],"confidence":"medium","falsifier":"BEIR jumps with yields","horizon":"1w","kind":"judgment","certainty":"interpretation"}]}',
            },
          ],
        }),
      execute: ({
        asof,
        facts,
        factsJson,
        judgments,
        judgmentsJson,
        signals,
        signalsJson,
        focusMarkets,
        dataLimitations,
        dataLimitationsJson,
      }) => {
        try {
          const factsDoc = resolveFacts(facts, factsJson)
          let signalList: MarketSignal[] | undefined = signals
          if (signalsJson) {
            const parsed = parseJsonObject<unknown>(signalsJson, 'signalsJson')
            if (!Array.isArray(parsed)) throw new Error('signalsJson must be an array')
            signalList = parsed.map((s) => MarketSignalSchema.parse(s))
          }
          let limitations = dataLimitations
          if (dataLimitationsJson) {
            const parsed = parseJsonObject<unknown>(dataLimitationsJson, 'dataLimitationsJson')
            if (!Array.isArray(parsed) || !parsed.every((g) => typeof g === 'string')) {
              throw new Error('dataLimitationsJson must be a JSON string array')
            }
            limitations = parsed
          }
          const document = buildAnalysisDocument({
            asof,
            facts: factsDoc,
            ...(judgments || judgmentsJson
              ? { judgments: resolveJudgments(judgments, judgmentsJson) }
              : {}),
            ...(signalList ? { signals: signalList } : {}),
            ...(focusMarkets ? { focus_markets: focusMarkets } : {}),
            ...(limitations ? { data_limitations: limitations } : {}),
          })
          const validation = validateAnalysisDocument(document)
          return { ok: validation.ok, document, validation }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    briefRenderAnalysis: tool({
      description: `Render two-layer markdown from analysis.json: Executive Summary (今天最重要的三个变化) + Detailed Analysis + 数据限制.

Stdout is markdown for --output report.draft.md. Then polish per traderhub editorial-style; run editorial-check before final report.md.`,
      inputSchema: z
        .object({
          analysis: AnalysisDocumentSchema.optional(),
          analysisJson: z.string().optional().describe('AnalysisDocument JSON; CLI --analysis-json-file'),
          title: z.string().optional(),
          locale: z.enum(['zh', 'en']).optional(),
        })
        .meta({ examples: [{ analysisJson: '{"version":1,"asof":"2026-09-30","facts":[],"signals":[],"data_limitations":[]}' }] }),
      execute: ({ analysis, analysisJson, title, locale }) => {
        const doc = resolveAnalysis(analysis, analysisJson)
        const rendered = renderAnalysisMarkdown(doc, {
          ...(title ? { title } : {}),
          ...(locale ? { locale } : {}),
        })
        const banner = `<!-- openalice-brief-analysis ok=${rendered.ok} signals=${rendered.validation.signal_ids.length} -->\n`
        return banner + rendered.markdown
      },
    }),

    briefEditorialCheck: tool({
      description: `Editorial Layer gate: compare edited markdown against analysis.json (or source prose).

Fails on unit flips (27bp→27%), dropped data limitations, uncertainty collapsed into certainty. Warns on orphan numbers / hedges removed. Soft length-budget warnings on exec summary.`,
      inputSchema: z
        .object({
          analysis: AnalysisDocumentSchema.optional(),
          analysisJson: z.string().optional().describe('AnalysisDocument JSON; CLI --analysis-json-file'),
          sourceProse: z.string().optional().describe('Fallback source text if analysis omitted'),
          edited: z.string().min(1).describe('Edited report markdown; CLI --edited-file path'),
        })
        .meta({
          examples: [
            {
              analysisJson:
                '{"version":1,"asof":"2026-09-30","facts":[{"id":"x","series_id":"FRED:DGS30","value":5.56,"unit":"pct","asof":"2026-09-28","source":"FRED","caliber":"fred_daily","fetched_at":"2026-09-30T12:00:00Z","kind":"observed"}],"signals":[{"id":"s1","title":"长端承压","conclusion":"长端利率仍高，可能主要来自实际利率","certainty":"interpretation","evidence_ids":["x"],"interpretation":[],"hypotheses":[],"watch_points":[],"confidence":"medium"}],"data_limitations":["南北向资金未获得"]}',
              edited:
                '## 今天最重要的三个变化\n\n长端利率仍高，可能主要来自实际利率。\n\n## 数据限制\n\n- 南北向资金未获得\n',
            },
          ],
        }),
      execute: ({ analysis, analysisJson, sourceProse, edited }) => {
        let doc: AnalysisDocument | undefined
        if (analysis || analysisJson) doc = resolveAnalysis(analysis, analysisJson)
        const result = validateEditorial({
          ...(doc ? { analysis: doc } : {}),
          ...(sourceProse ? { sourceProse } : {}),
          edited,
        })
        const lengthWarnings = checkLengthBudgets(edited)
        return {
          ...result,
          warnings: [...result.warnings, ...lengthWarnings],
          ok: result.ok,
        }
      },
    }),

    briefStyle: tool({
      description: `Return the Chinese financial editorial style guide summary and path for the Editorial Pass. Read references/editorial-style.md in the traderhub skill for the full rules.`,
      inputSchema: z.object({}).meta({ examples: [{}] }),
      execute: () => ({
        skill_reference: 'traderhub/references/editorial-style.md',
        principle: 'Semantic fidelity > elegance. Clarity > verbosity. Precision > rhetorical effect.',
        certainty_grades: ['fact', 'derived_fact', 'interpretation', 'hypothesis', 'forecast', 'data_limitation'],
        forbidden_upgrades: [
          'hypothesis → fact',
          'interpretation → fact',
          '可能/尚无法确认 → 推动了/可以确认',
          'bp ↔ % unit flip',
        ],
        structure: [
          'Executive Summary: 今天最重要的三个变化 (150–280 chars soft)',
          'Each signal: 结论 → 证据 → 解读/推测 → 观察点(≤3)',
          'Data limitations must survive editorial polish',
        ],
        ai_tells_to_minimize: ['值得注意的是', '不难发现', '可以看到', '这说明', '这意味着', '需要指出的是'],
      }),
    }),
  }
}

function resolveAnalysis(analysis?: AnalysisDocument, analysisJson?: string): AnalysisDocument {
  if (analysis && analysisJson) throw new Error('Pass either analysis or analysisJson, not both')
  if (analysis) return AnalysisDocumentSchema.parse(analysis)
  if (analysisJson) return AnalysisDocumentSchema.parse(parseJsonObject(analysisJson, 'analysisJson'))
  throw new Error('analysis or analysisJson is required')
}
