import { describe, expect, it } from 'vitest'
import { assertScenarioPath, validateScenarioCoverage } from './scenario-catalog.js'
import type { ThemeColorScenario } from './types.js'

const source = { inventoryId: 'color-a', path: 'ui/src/A.tsx', sourceText: 'text-red-500', sourceClass: 'runtime', syntaxKind: 'tailwind-palette-utility', ownerHint: 'A', role: 'color-consumer', span: { startOffset: 0, endOffset: 12, startLine: 1, startColumn: 1, endLine: 1, endColumn: 13 } } as const
const scenario: ThemeColorScenario = { scenarioId: 'a', route: '/a', fixtureProfile: 'demo', state: 'normal', themes: ['light'], viewport: { width: 100, height: 100 }, ready: { role: 'main' }, actions: [], expectedSurface: 'dom-or-css', inventoryIds: ['color-a'] }

describe('occurrence-driven scenario coverage', () => {
  it('accepts an explicit inventory assignment', () => expect(() => validateScenarioCoverage([source.inventoryId], [scenario])).not.toThrow())
  it('rejects missing and stale IDs', () => {
    expect(() => validateScenarioCoverage([source.inventoryId], [])).toThrow('without scenarios')
    expect(() => validateScenarioCoverage([source.inventoryId], [{ ...scenario, inventoryIds: ['color-stale'] }])).toThrow('unknown or stale')
  })
  it('requires a real action for a non-baseline state', () => expect(() => validateScenarioCoverage([source.inventoryId], [{ ...scenario, state: 'warning' }])).toThrow('requires a user action'))
  it('compares route pathnames without treating a required query as a redirect', () => {
    expect(() => assertScenarioPath('first-run', '/onboarding?onboardingStep=broker', 'http://127.0.0.1:5173/onboarding?onboardingStep=broker&themeAuditFixture=first-run-locked')).not.toThrow()
    expect(() => assertScenarioPath('first-run', '/onboarding?onboardingStep=broker', 'http://127.0.0.1:5173/chat')).toThrow('redirected')
  })
})
