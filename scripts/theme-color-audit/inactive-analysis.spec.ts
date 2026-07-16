import { describe, expect, it } from 'vitest'
import { classifyInactive } from './inactive-analysis.js'
import type { RuntimeColorBinding, StaticColorOccurrence } from './types.js'

const source = (syntaxKind: StaticColorOccurrence['syntaxKind']): StaticColorOccurrence => ({
  inventoryId: 'color-fixture', path: 'ui/src/Fixture.tsx', sourceText: '#fff', sourceClass: 'runtime', syntaxKind, ownerHint: 'Fixture',
  span: { startOffset: 0, endOffset: 4, startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
})
const binding = (surfaceKind: RuntimeColorBinding['surfaceKind'], target: RuntimeColorBinding['target'] = null): RuntimeColorBinding => ({
  inventoryId: 'color-fixture', scenarioId: 'fixture', theme: 'light', surfaceKind, channel: 'color', actualValue: '#fff', active: false, target,
})

describe('inactive color analysis', () => {
  it('classifies observable binding shapes without unknown fallback', () => {
    expect(classifyInactive(source('css-color-literal'), [binding('css-rule')])).toBe('css-selector-unmatched')
    expect(classifyInactive(source('tailwind-palette-utility'), [binding('dom-element')])).toBe('jsx-target-not-rendered')
    expect(classifyInactive(source('tailwind-palette-utility'), [binding('dom-element', { selector: '#x', x: 0, y: 0, width: 1, height: 1 })])).toBe('tailwind-class-inactive')
    expect(classifyInactive(source('typescript-color-literal'), [binding('runtime-value')])).toBe('runtime-expression-not-evaluated')
  })

  it('rejects an active occurrence from the inactive pipeline', () => {
    expect(() => classifyInactive(source('typescript-color-literal'), [{ ...binding('runtime-value'), active: true }])).toThrow('active occurrence')
  })
})
