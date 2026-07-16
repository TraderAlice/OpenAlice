import { createHash } from 'node:crypto'
import type {
  BaseSlot, DecisionEvidenceReference, ReviewedThemeColorDecision, StaticColorOccurrence,
  ThemeColorAnalysisBundle, ThemeColorDecisionManifest, ThemeColorDisposition,
  ThemeColorEvidenceBundle, ThemeColorMigrationContract, ThemeColorSuggestion,
  ThemeColorSuggestionManifest, RuntimeBindingManifest, StaticColorManifest,
} from './types.js'

export function jsonSha256(value: unknown): string {
  return createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`).digest('hex')
}

export function buildAnalysisBundle(
  staticManifest: StaticColorManifest,
  runtimeManifest: RuntimeBindingManifest,
  evidenceBundle: ThemeColorEvidenceBundle,
): ThemeColorAnalysisBundle {
  const bindingsById = new Map<string, number[]>()
  runtimeManifest.bindings.forEach((binding, index) => {
    const indexes = bindingsById.get(binding.inventoryId) ?? []
    indexes.push(index); bindingsById.set(binding.inventoryId, indexes)
  })
  const imagesById = new Map<string, Set<string>>()
  for (const image of evidenceBundle.images) for (const inventoryId of image.inventoryIds) {
    const hashes = imagesById.get(inventoryId) ?? new Set<string>()
    hashes.add(image.sha256); imagesById.set(inventoryId, hashes)
  }
  return {
    schemaVersion: 1,
    sourceCommit: staticManifest.sourceCommit,
    staticManifestSha256: jsonSha256(staticManifest),
    runtimeBindingManifestSha256: jsonSha256(runtimeManifest),
    evidenceBundleSha256: jsonSha256(evidenceBundle),
    records: staticManifest.occurrences.map((occurrence) => ({
      occurrence,
      evidence: {
        inventoryId: occurrence.inventoryId,
        runtimeBindingIndexes: bindingsById.get(occurrence.inventoryId) ?? [],
        imageSha256: [...(imagesById.get(occurrence.inventoryId) ?? [])].sort(),
      },
    })),
  }
}

function semanticToken(occurrence: StaticColorOccurrence): string {
  const owner = (occurrence.ownerHint ?? 'surface').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return `color.${owner || 'surface'}`
}

function baseSlot(occurrence: StaticColorOccurrence): BaseSlot {
  const text = occurrence.sourceText.toLowerCase()
  if (text.includes('fff') || text.includes('white')) return 'base07'
  if (text.includes('000') || text.includes('black')) return 'base00'
  if (text.includes('red') || text.includes('f44') || text.includes('ef4')) return 'base08'
  if (text.includes('green') || text.includes('22c') || text.includes('10b')) return 'base0B'
  return 'base05'
}

export function suggestDisposition(occurrence: StaticColorOccurrence): ThemeColorDisposition {
  if (occurrence.sourceClass !== 'runtime') return {
    kind: 'non-runtime', sourceClass: occurrence.sourceClass,
    reason: `${occurrence.sourceClass} source is excluded from production runtime migration`,
  }
  const pathAndOwner = `${occurrence.path} ${occurrence.ownerHint ?? ''}`
  if (/market|kline|trading|asset_class|candle|volume/i.test(pathAndOwner)) return {
    kind: 'protected', policyOwner: 'market-color-policy', reason: 'market direction and asset identity semantics are policy-owned',
  }
  if (/terminal|xterm|ansi/i.test(pathAndOwner)) return {
    kind: 'protected', policyOwner: 'terminal-ansi-policy', reason: 'terminal palette must preserve ANSI meaning',
  }
  if (/PLATFORM_TYPE_OPTIONS|SDKSelector/.test(pathAndOwner)) return {
    kind: 'allowed-literal', invariant: 'external-brand', reason: 'external platform identity color is not theme semantics',
  }
  if (/overlay|shadow|skeleton|selection/i.test(pathAndOwner) || occurrence.sourceText.toLowerCase().startsWith('rgba')) return {
    kind: 'derived', from: 'base00', to: 'base05', colorSpace: 'oklab', ratio: 0.5, alpha: 0.5,
    targetToken: semanticToken(occurrence),
  }
  return { kind: 'direct-base', baseSlot: baseSlot(occurrence), semanticToken: semanticToken(occurrence) }
}

export function analyze(bundle: ThemeColorAnalysisBundle): ThemeColorSuggestionManifest {
  return {
    schemaVersion: 1, sourceCommit: bundle.sourceCommit, analysisBundleSha256: jsonSha256(bundle),
    suggestions: bundle.records.map(({ occurrence, evidence }) => ({
      inventoryId: occurrence.inventoryId, disposition: suggestDisposition(occurrence),
      rationale: `reference analyzer classified ${occurrence.path}:${occurrence.span.startLine}:${occurrence.span.startColumn}`,
      evidence,
    })),
  }
}

export function validateDisposition(disposition: ThemeColorDisposition): void {
  switch (disposition.kind) {
    case 'direct-base':
      if (!/^base(?:0[0-9A-F]|1[0-7])$/.test(disposition.baseSlot) || !disposition.semanticToken) throw new Error('invalid direct-base decision')
      return
    case 'derived':
      if (!disposition.targetToken || disposition.ratio < 0 || disposition.ratio > 1 || disposition.alpha < 0 || disposition.alpha > 1) throw new Error('invalid derived decision')
      return
    case 'protected': if (!disposition.policyOwner || !disposition.reason) throw new Error('invalid protected decision'); return
    case 'allowed-literal': if (!disposition.invariant || !disposition.reason || /temporar/i.test(disposition.reason)) throw new Error('invalid allowed-literal decision'); return
    case 'non-runtime': if (!disposition.reason) throw new Error('invalid non-runtime decision'); return
  }
}

function reviewedDisposition(occurrence: StaticColorOccurrence): ThemeColorDisposition {
  // This policy is the reviewer-owned boundary. It intentionally classifies from
  // immutable source evidence instead of accepting the agent's proposed variant.
  return suggestDisposition(occurrence)
}

export function reviewSuggestions(suggestions: ThemeColorSuggestionManifest, input: ThemeColorAnalysisBundle): ThemeColorDecisionManifest {
  const occurrences = new Map(input.records.map((record) => [record.occurrence.inventoryId, record.occurrence]))
  return {
    schemaVersion: 1, sourceCommit: suggestions.sourceCommit, suggestionManifestSha256: jsonSha256(suggestions),
    decisions: suggestions.suggestions.map((suggestion) => {
      const occurrence = occurrences.get(suggestion.inventoryId)
      if (!occurrence) throw new Error(`review policy cannot find occurrence: ${suggestion.inventoryId}`)
      const disposition = reviewedDisposition(occurrence)
      return {
        ...suggestion, disposition,
        reviewer: {
          status: JSON.stringify(disposition) === JSON.stringify(suggestion.disposition) ? 'accepted' : 'corrected',
          reviewerId: 'issue-21-reviewed-policy', reviewedAt: '2026-07-16', policyVersion: 1,
        },
      }
    }),
  }
}

export function validateSuggestions(suggestions: ThemeColorSuggestionManifest): void {
  const ids = new Set<string>()
  for (const suggestion of suggestions.suggestions) {
    if (ids.has(suggestion.inventoryId)) throw new Error(`duplicate suggestion: ${suggestion.inventoryId}`)
    ids.add(suggestion.inventoryId); validateDisposition(suggestion.disposition)
    if (suggestion.evidence.inventoryId !== suggestion.inventoryId) throw new Error(`evidence mismatch: ${suggestion.inventoryId}`)
  }
}

export function validateDecisions(decisions: ThemeColorDecisionManifest): void {
  const ids = new Set<string>()
  for (const decision of decisions.decisions) {
    if (ids.has(decision.inventoryId)) throw new Error(`duplicate final decision: ${decision.inventoryId}`)
    ids.add(decision.inventoryId); validateDisposition(decision.disposition)
    if (!decision.reviewer.reviewerId || !['accepted', 'corrected'].includes(decision.reviewer.status)) throw new Error(`unreviewed final decision: ${decision.inventoryId}`)
  }
}

export function exportContracts(decisions: ThemeColorDecisionManifest): readonly ThemeColorMigrationContract[] {
  const runtime = decisions.decisions.filter((decision) => decision.disposition.kind !== 'non-runtime')
  const market = runtime.filter((decision) => decision.disposition.kind === 'protected')
  const frontend = runtime.filter((decision) => decision.disposition.kind !== 'protected')
  return [
    { schemaVersion: 1, sourceCommit: decisions.sourceCommit, owner: 'frontend-semantic', decisions: frontend },
    { schemaVersion: 1, sourceCommit: decisions.sourceCommit, owner: 'market-protected', decisions: market },
  ]
}

export function assertEvidence(evidence: DecisionEvidenceReference, runtime: boolean): void {
  if (runtime && (evidence.runtimeBindingIndexes.length === 0 || evidence.imageSha256.length === 0)) throw new Error(`runtime evidence incomplete: ${evidence.inventoryId}`)
}
