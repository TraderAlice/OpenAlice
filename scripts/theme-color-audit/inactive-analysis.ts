import type { RuntimeColorBinding, StaticColorOccurrence } from './types.js'

export type InactiveReason =
  | 'css-selector-unmatched'
  | 'tailwind-class-inactive'
  | 'jsx-target-not-rendered'
  | 'runtime-expression-not-evaluated'

export interface InactiveAnalysisRecord {
  readonly inventoryId: string
  readonly source: StaticColorOccurrence
  readonly reason: InactiveReason
  readonly bindingCount: number
  readonly scenarios: readonly string[]
  readonly bindingShapes: readonly string[]
}

export interface InactiveAnalysisManifest {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly records: readonly InactiveAnalysisRecord[]
}

function bindingShape(binding: RuntimeColorBinding): string {
  return [binding.scenarioId, binding.theme, binding.surfaceKind, binding.active ? 'active' : 'inactive', binding.target ? 'target' : 'no-target'].join('/')
}

export function classifyInactive(source: StaticColorOccurrence, bindings: readonly RuntimeColorBinding[]): InactiveReason {
  if (bindings.some((binding) => binding.active)) throw new Error(`${source.inventoryId}: active occurrence cannot enter inactive analysis`)
  if (source.syntaxKind === 'css-color-literal') return 'css-selector-unmatched'
  if (source.syntaxKind === 'tailwind-palette-utility') {
    return bindings.some((binding) => binding.surfaceKind === 'dom-element' && binding.target !== null)
      ? 'tailwind-class-inactive'
      : 'jsx-target-not-rendered'
  }
  return 'runtime-expression-not-evaluated'
}

export function analyzeInactive(
  sourceCommit: string,
  occurrences: readonly StaticColorOccurrence[],
  bindings: readonly RuntimeColorBinding[],
  inactiveIds: ReadonlySet<string>,
): InactiveAnalysisManifest {
  const byId = new Map<string, RuntimeColorBinding[]>()
  for (const binding of bindings) {
    const list = byId.get(binding.inventoryId) ?? []; list.push(binding); byId.set(binding.inventoryId, list)
  }
  const records = occurrences.filter((source) => inactiveIds.has(source.inventoryId)).map((source) => {
    const occurrenceBindings = byId.get(source.inventoryId) ?? []
    if (occurrenceBindings.length === 0) throw new Error(`${source.inventoryId}: inactive occurrence has no binding history`)
    return {
      inventoryId: source.inventoryId, source, reason: classifyInactive(source, occurrenceBindings),
      bindingCount: occurrenceBindings.length,
      scenarios: [...new Set(occurrenceBindings.map((binding) => binding.scenarioId))].sort(),
      bindingShapes: [...new Set(occurrenceBindings.map(bindingShape))].sort(),
    }
  }).sort((left, right) => left.inventoryId.localeCompare(right.inventoryId))
  return { schemaVersion: 1, sourceCommit, records }
}

export function validateInactiveAnalysis(manifest: InactiveAnalysisManifest, expectedIds: ReadonlySet<string>): void {
  const actual = new Set<string>()
  for (const record of manifest.records) {
    if (actual.has(record.inventoryId)) throw new Error(`duplicate inactive analysis: ${record.inventoryId}`)
    actual.add(record.inventoryId)
    if (record.source.inventoryId !== record.inventoryId || record.bindingCount <= 0 || record.scenarios.length === 0 || record.bindingShapes.length === 0) throw new Error(`${record.inventoryId}: incomplete inactive evidence`)
  }
  const missing = [...expectedIds].filter((id) => !actual.has(id))
  const extra = [...actual].filter((id) => !expectedIds.has(id))
  if (missing.length > 0 || extra.length > 0) throw new Error(`inactive analysis set mismatch; missing=${missing.join(',')} extra=${extra.join(',')}`)
}
