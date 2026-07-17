import { describe, expect, it } from 'vitest'
import type { ThemeColorOccurrenceEvidence } from './evidence.js'
import { exportContracts, hashJson, suggestMigration, validateDecisionManifest, validateSuggestionManifest, type MigrationDecisionManifest, type MigrationSuggestionManifest } from './migration-contract.js'

const entry = (id: string, sourceText = 'text-red-400', path = 'ui/src/components/Alert.tsx'): ThemeColorOccurrenceEvidence => ({
  kind: 'occurrence-evidence', inventoryId: id,
  source: { path, sourceText, span: { startOffset: 1, endOffset: 2, startLine: 1, startColumn: 2, endLine: 1, endColumn: 3 } },
  scenario: { scenarioId: 'alert', state: 'error', fixtureProfile: 'demo', theme: 'light' }, channel: 'text', actualValue: 'rgb(248, 113, 113)',
  target: { selector: `[data-id="${id}"]`, x: 1, y: 2, width: 3, height: 4, active: true }, sampleBounds: { selector: 'x', x: 0, y: 0, width: 10, height: 10 },
  context: { path: `${id}-context.jpg`, sha256: 'a'.repeat(64), width: 10, height: 10, label: id }, crop: { path: `${id}-crop.jpg`, sha256: 'b'.repeat(64), width: 10, height: 10, label: id },
})
const suggestions = (...entries: ThemeColorOccurrenceEvidence[]): MigrationSuggestionManifest => ({ schemaVersion: 1, sourceCommit: 'abc1234', evidenceManifestSha256: 'c'.repeat(64), suggestions: entries.map(suggestMigration) })
const decisions = (manifest: MigrationSuggestionManifest): MigrationDecisionManifest => ({ schemaVersion: 1, sourceCommit: manifest.sourceCommit, suggestionManifestSha256: hashJson(manifest), decisions: manifest.suggestions.map((item) => ({ ...item, reviewer: { status: 'accepted', reviewerId: 'reviewer', reviewedAt: '2026-07-17', policyVersion: 1 } })) })

describe('migration contract', () => {
  it('keeps suggestions separate from explicitly reviewed final decisions', () => {
    const manifest = suggestions(entry('color-a'))
    expect(() => validateDecisionManifest(manifest as unknown as MigrationDecisionManifest, manifest)).toThrow()
    expect(() => validateDecisionManifest(decisions(manifest), manifest)).not.toThrow()
  })
  it('rejects missing, duplicate, and orphan suggestions', () => {
    const manifest = suggestions(entry('color-a'))
    expect(() => validateSuggestionManifest(manifest, ['color-a', 'color-b'])).toThrow(/missing/)
    expect(() => validateSuggestionManifest({ ...manifest, suggestions: [...manifest.suggestions, ...manifest.suggestions] }, ['color-a'])).toThrow(/duplicate/)
    expect(() => validateSuggestionManifest(manifest, ['color-b'])).toThrow(/orphan/)
  })
  it('does not merge identical literals across owners', () => {
    const manifest = suggestions(entry('color-a'), entry('color-b'))
    validateSuggestionManifest(manifest, ['color-a', 'color-b'])
    expect(manifest.suggestions.map((item) => item.inventoryId)).toEqual(['color-a', 'color-b'])
  })
  it('exports protected market decisions only to #18', () => {
    const manifest = suggestions(entry('color-a'), entry('color-market', '#3fb950', 'ui/src/components/market/KlinePanel.tsx'))
    const [frontend, protectedContract] = exportContracts(decisions(manifest))
    expect(frontend.decisions.map((item) => item.inventoryId)).toEqual(['color-a'])
    expect(protectedContract.decisions.map((item) => item.inventoryId)).toEqual(['color-market'])
  })
  it('keeps transparent no-paint as a justified allowed literal', () => {
    const suggestion = suggestMigration(entry('color-transparent', 'transparent'))
    expect(suggestion.disposition.kind).toBe('allowed-literal'); expect(suggestion.proposedCssVariable).toBeNull()
  })
})
