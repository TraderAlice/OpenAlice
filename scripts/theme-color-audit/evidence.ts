import type { RuntimeTarget, SourceSpan } from './types.js'

export const THEME_COLOR_EVIDENCE_SCHEMA_VERSION = 1 as const

export interface EvidenceImage {
  readonly path: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly label: string
}

export interface ThemeColorOccurrenceEvidence {
  readonly kind: 'occurrence-evidence'
  readonly inventoryId: string
  readonly source: { readonly path: string; readonly sourceText: string; readonly span: SourceSpan }
  readonly scenario: { readonly scenarioId: string; readonly state: string; readonly fixtureProfile: string; readonly theme: 'light' | 'dark' }
  readonly channel: string
  readonly actualValue: string
  readonly target: RuntimeTarget & { readonly active: true }
  readonly sampleBounds: RuntimeTarget
  readonly context: EvidenceImage
  readonly crop: EvidenceImage
}

export interface ThemeColorEvidenceManifest {
  readonly schemaVersion: typeof THEME_COLOR_EVIDENCE_SCHEMA_VERSION
  readonly sourceCommit: string
  readonly entries: readonly ThemeColorOccurrenceEvidence[]
}

export interface ExpectedEvidenceOccurrence {
  readonly inventoryId: string
  readonly path: string
  readonly sourceText: string
  readonly span: SourceSpan
}

const HASH = /^[0-9a-f]{64}$/i
const COMMIT = /^[0-9a-f]{7,64}$/i
const rec = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-blank`)
  return value
}
const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}
const span = (value: unknown, label: string): SourceSpan => {
  const input = rec(value, label)
  return { startOffset: number(input.startOffset, `${label}.startOffset`), endOffset: number(input.endOffset, `${label}.endOffset`), startLine: number(input.startLine, `${label}.startLine`), startColumn: number(input.startColumn, `${label}.startColumn`), endLine: number(input.endLine, `${label}.endLine`), endColumn: number(input.endColumn, `${label}.endColumn`) }
}
const bounds = (value: unknown, label: string, requireActive = false): RuntimeTarget & { active?: true } => {
  const input = rec(value, label)
  if (requireActive && input.active !== true) throw new Error(`${label} is inactive`)
  const result = { selector: text(input.selector, `${label}.selector`), x: number(input.x, `${label}.x`), y: number(input.y, `${label}.y`), width: number(input.width, `${label}.width`), height: number(input.height, `${label}.height`) }
  if (result.width <= 0 || result.height <= 0) throw new Error(`${label} must have positive area`)
  return requireActive ? { ...result, active: true } : result
}
const image = (value: unknown, label: string): EvidenceImage => {
  const input = rec(value, label)
  const sha256 = text(input.sha256, `${label}.sha256`)
  if (!HASH.test(sha256)) throw new Error(`${label}.sha256 must be a 64-character hexadecimal hash`)
  const result = { path: text(input.path, `${label}.path`), sha256: sha256.toLowerCase(), width: number(input.width, `${label}.width`), height: number(input.height, `${label}.height`), label: text(input.label, `${label}.label`) }
  if (result.width <= 0 || result.height <= 0) throw new Error(`${label} must have positive dimensions`)
  return result
}

export function validateThemeColorEvidenceManifest(input: unknown, expected: readonly (string | ExpectedEvidenceOccurrence)[], currentCommit: string): ThemeColorEvidenceManifest {
  const manifest = rec(input, 'evidence manifest')
  if (manifest.schemaVersion !== 1) throw new Error('unsupported evidence manifest schemaVersion')
  const sourceCommit = text(manifest.sourceCommit, 'evidence manifest sourceCommit')
  if (!COMMIT.test(sourceCommit)) throw new Error('evidence manifest sourceCommit must be a git commit hash')
  if (sourceCommit !== currentCommit) throw new Error(`stale evidence source commit: expected ${currentCommit}, received ${sourceCommit}`)
  if (!Array.isArray(manifest.entries)) throw new Error('evidence manifest entries must be an array')
  const expectedById = new Map(expected.map((item) => typeof item === 'string' ? [item, null] : [item.inventoryId, item] as const))
  const seen = new Set<string>()
  const entries = manifest.entries.map((value, index): ThemeColorOccurrenceEvidence => {
    const item = rec(value, `entries[${index}]`)
    if ('inventoryIds' in item) throw new Error(`entries[${index}] must not share inventoryIds; one occurrence per entry is required`)
    if (item.kind !== 'occurrence-evidence') throw new Error(`entries[${index}] rejects scenario-only or runtime-value evidence; kind must be occurrence-evidence`)
    const inventoryId = text(item.inventoryId, `entries[${index}].inventoryId`)
    if (!expectedById.has(inventoryId)) throw new Error(`orphan evidence inventoryId: ${inventoryId}`)
    if (seen.has(inventoryId)) throw new Error(`inventoryId is shared by multiple evidence entries: ${inventoryId}`)
    seen.add(inventoryId)
    const sourceInput = rec(item.source, `entries[${index}].source`)
    const source = { path: text(sourceInput.path, `entries[${index}].source.path`), sourceText: text(sourceInput.sourceText, `entries[${index}].source.sourceText`), span: span(sourceInput.span, `entries[${index}].source.span`) }
    const wanted = expectedById.get(inventoryId)
    if (wanted && (source.path !== wanted.path || source.sourceText !== wanted.sourceText || JSON.stringify(source.span) !== JSON.stringify(wanted.span))) throw new Error(`stale source metadata for ${inventoryId}`)
    const scenarioInput = rec(item.scenario, `entries[${index}].scenario`)
    const theme = scenarioInput.theme
    if (theme !== 'light' && theme !== 'dark') throw new Error(`entries[${index}].scenario.theme must be light or dark`)
    return { kind: 'occurrence-evidence', inventoryId, source, scenario: { scenarioId: text(scenarioInput.scenarioId, `entries[${index}].scenario.scenarioId`), state: text(scenarioInput.state, `entries[${index}].scenario.state`), fixtureProfile: text(scenarioInput.fixtureProfile, `entries[${index}].scenario.fixtureProfile`), theme }, channel: text(item.channel, `entries[${index}].channel`), actualValue: text(item.actualValue, `entries[${index}].actualValue`), target: bounds(item.target, `entries[${index}].target`, true) as RuntimeTarget & { active: true }, sampleBounds: bounds(item.sampleBounds, `entries[${index}].sampleBounds`), context: image(item.context, `entries[${index}].context`), crop: image(item.crop, `entries[${index}].crop`) }
  })
  const missing = [...expectedById.keys()].filter((id) => !seen.has(id))
  if (missing.length) throw new Error(`missing occurrence evidence (${missing.length}): ${missing.join(', ')}`)
  return { schemaVersion: 1, sourceCommit, entries }
}

export const validateEvidenceManifest = validateThemeColorEvidenceManifest
