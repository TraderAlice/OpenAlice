import { describe, expect, it } from 'vitest'
import { resolveScenarioCoverage, validateScenarioCatalog } from './scenario-catalog.js'
import type { StaticColorManifest, ThemeColorScenario } from './types.js'

describe('theme color scenario catalog', () => {
  it('rejects duplicate scenario identities', () => {
    const duplicate = [{
      scenarioId: 'same', route: '/one', fixtureProfile: 'demo', state: 'normal', themes: ['light'],
      viewport: { width: 100, height: 100 }, ready: { role: 'main' }, actions: [], sourcePaths: ['ui/src/A.tsx'],
    }, {
      scenarioId: 'same', route: '/two', fixtureProfile: 'demo', state: 'normal', themes: ['dark'],
      viewport: { width: 100, height: 100 }, ready: { role: 'main' }, actions: [], sourcePaths: ['ui/src/B.tsx'],
    }] satisfies ThemeColorScenario[]
    expect(() => validateScenarioCatalog(duplicate)).toThrow('duplicate scenario ID')
  })

  it('fails when a runtime source owner has no executable scenario', () => {
    const manifest: StaticColorManifest = {
      schemaVersion: 1, sourceCommit: 'fixture', generatedFrom: 'ui/src', occurrences: [{
        inventoryId: 'color-missing', path: 'ui/src/unmapped.tsx', sourceText: '#fff', sourceClass: 'runtime',
        syntaxKind: 'typescript-color-literal', ownerHint: 'Unmapped',
        span: { startOffset: 0, endOffset: 4, startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
      }],
    }
    const scenario: ThemeColorScenario = {
      scenarioId: 'mapped-only', route: '/mapped', fixtureProfile: 'demo', state: 'normal', themes: ['light'],
      viewport: { width: 100, height: 100 }, ready: { role: 'main' }, actions: [], sourcePaths: ['ui/src/mapped.tsx'],
    }
    const mapped = { ...manifest.occurrences[0]!, inventoryId: 'color-mapped', path: 'ui/src/mapped.tsx' }
    expect(() => resolveScenarioCoverage({ ...manifest, occurrences: [mapped, ...manifest.occurrences] }, [scenario], []))
      .toThrow('runtime source paths without scenarios')
  })
})
