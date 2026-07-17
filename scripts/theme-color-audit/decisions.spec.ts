import { describe, expect, it } from 'vitest'
import { analyze, buildAnalysisBundle, exportContracts, reviewSuggestions, validateDecisions, validateDisposition } from './decisions.js'
import type { RuntimeBindingManifest, StaticColorManifest, ThemeColorEvidenceBundle } from './types.js'

const occurrence = (id: string, sourceClass: 'runtime' | 'demo' = 'runtime') => ({
  inventoryId: id, path: sourceClass === 'runtime' ? 'ui/src/components/Panel.tsx' : 'ui/src/demo/Panel.tsx',
  sourceText: '#ffffff', sourceClass, syntaxKind: 'typescript-color-literal' as const, ownerHint: 'Panel',
  span: { startOffset: 0, endOffset: 7, startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 },
})

describe('theme color decisions', () => {
  it('keeps agent suggestions separate from reviewed final decisions', () => {
    const staticManifest: StaticColorManifest = { schemaVersion: 1, sourceCommit: 'abc', generatedFrom: 'ui/src', occurrences: [occurrence('runtime'), occurrence('demo', 'demo')] }
    const runtimeManifest: RuntimeBindingManifest = { schemaVersion: 1, sourceCommit: 'abc', bindings: [{ inventoryId: 'runtime', scenarioId: 'panel', theme: 'light', surfaceKind: 'dom-element', channel: 'color', actualValue: 'rgb(255,255,255)', active: true, target: null }] }
    const evidence: ThemeColorEvidenceBundle = { schemaVersion: 2, sourceCommit: 'abc', staticManifestSchemaVersion: 1, runtimeBindingSchemaVersion: 1, playwrightVersion: '1', browserVersion: '1', images: [{ scenarioId: 'panel', theme: 'light', state: 'normal', relativePath: 'panel.jpg', sha256: 'hash', format: 'jpeg', quality: 80, width: 10, height: 10, viewport: { width: 10, height: 10 }, deviceScaleFactor: 1, inventoryIds: ['runtime'] }], occurrenceRecords: [{ kind: 'non-visual-probe', inventoryId: 'runtime', source: occurrence('runtime'), bindingIndexes: [0], reason: 'runtime-value' }] }
    const input = buildAnalysisBundle(staticManifest, runtimeManifest, evidence)
    const suggestions = analyze(input)
    expect(suggestions.suggestions[0]).not.toHaveProperty('reviewer')
    const decisions = reviewSuggestions(suggestions, input); validateDecisions(decisions)
    expect(decisions.decisions[0]?.reviewer.status).toBe('accepted')
    expect(exportContracts(decisions).flatMap((contract) => contract.decisions)).toHaveLength(1)
  })

  it('does not promote an agent suggestion by merely labeling it reviewed', () => {
    const staticManifest: StaticColorManifest = { schemaVersion: 1, sourceCommit: 'abc', generatedFrom: 'ui/src', occurrences: [occurrence('runtime')] }
    const input = buildAnalysisBundle(staticManifest, { schemaVersion: 1, sourceCommit: 'abc', bindings: [] }, { schemaVersion: 2, sourceCommit: 'abc', staticManifestSchemaVersion: 1, runtimeBindingSchemaVersion: 1, playwrightVersion: '1', browserVersion: '1', images: [], occurrenceRecords: [] })
    const suggestions = analyze(input)
    const tampered = { ...suggestions, suggestions: [{ ...suggestions.suggestions[0]!, disposition: { kind: 'allowed-literal', invariant: 'external-brand', reason: 'agent guess' } as const }] }
    const reviewed = reviewSuggestions(tampered, input)
    expect(reviewed.decisions[0]?.reviewer.status).toBe('corrected')
    expect(reviewed.decisions[0]?.disposition.kind).toBe('direct-base')
  })

  it('validates every disposition variant and rejects incomplete variants', () => {
    const variants = [
      { kind: 'direct-base', baseSlot: 'base00', semanticToken: 'color.bg' },
      { kind: 'derived', from: 'base00', to: 'base05', colorSpace: 'oklab', ratio: 0.5, alpha: 0.5, targetToken: 'color.overlay' },
      { kind: 'protected', policyOwner: 'market-color-policy', reason: 'market meaning' },
      { kind: 'allowed-literal', invariant: 'external-brand', reason: 'external identity' },
      { kind: 'non-runtime', sourceClass: 'demo', reason: 'demo only' },
    ] as const
    for (const variant of variants) expect(() => validateDisposition(variant)).not.toThrow()
    expect(() => validateDisposition({ kind: 'direct-base', baseSlot: 'base99', semanticToken: '' } as never)).toThrow()
    expect(() => validateDisposition({ kind: 'derived', from: 'base00', to: 'base05', colorSpace: 'oklab', ratio: 2, alpha: 0.5, targetToken: '' } as never)).toThrow()
    expect(() => validateDisposition({ kind: 'allowed-literal', invariant: 'external-brand', reason: 'temporarily keep' } as never)).toThrow()
  })
})
