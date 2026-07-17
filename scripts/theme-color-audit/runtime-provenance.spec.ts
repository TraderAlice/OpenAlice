import { describe, expect, it } from 'vitest'
import { auditRuntimeNames } from './audit-vite-plugin.js'
import { assertBindingIntegrity, assertEveryTarget, htmlReportComputedProperty, isCssColor, isTailwindRuntimeWinner, metadataForDeclaredIds, tailwindComputedChannel, type RuntimeBindingMetadata } from './runtime-provenance.js'
import type { RuntimeColorBinding } from './types.js'

const metadata = (overrides: Partial<RuntimeBindingMetadata> = {}): RuntimeBindingMetadata => ({ id: 'color-a', path: 'ui/src/A.tsx', sourceText: 'text-orange-400', syntaxKind: 'tailwind-palette-utility', channel: 'text', ...overrides })
const binding = (overrides: Partial<RuntimeColorBinding> = {}): RuntimeColorBinding => ({ inventoryId: 'color-a', scenarioId: 'scenario-a', theme: 'light', surfaceKind: 'dom-element', channel: 'text', actualValue: 'oklch(75% 0.15 50)', winner: { kind: 'tailwind-utility', sourceUtility: 'text-orange-400', activeClassToken: 'text-orange-400', isolatedValue: 'oklch(75% 0.15 50)' }, target: { selector: '.target', x: 1, y: 1, width: 20, height: 10 }, ...overrides })

describe('theme color audit runtime provenance', () => {
  it('uses names isolated from production domain attributes', () => {
    expect(auditRuntimeNames.ATTRIBUTE).toBe('data-openalice-color-audit')
    expect(auditRuntimeNames.VALUE_HOOK).toBe('__OPENALICE_THEME_COLOR_CONSUME__')
    expect(auditRuntimeNames.WINNER_PREFIX).toBe('--openalice-audit-winner-')
  })
  it('rejects missing and zero-area targets', () => {
    expect(() => assertEveryTarget(['color-a'], [], 'test')).toThrow('missing runtime targets')
    expect(() => assertBindingIntegrity([binding({ target: { selector: '.target', x: 0, y: 0, width: 0, height: 10 } })], [metadata()])).toThrow('zero-area')
    expect(() => assertBindingIntegrity([binding({ target: { selector: '#root', x: 0, y: 0, width: 100, height: 100 } })], [metadata()])).toThrow('page-root')
  })
  it('rejects a Tailwind utility string masquerading as its computed value', () => {
    expect(() => assertBindingIntegrity([binding({ actualValue: 'text-orange-400' })], [metadata()])).toThrow('Tailwind source text')
    expect(isCssColor('text-orange-400')).toBe(false)
    expect(isCssColor('#f97316')).toBe(true)
  })
  it('persists and validates exact Tailwind winner provenance', () => {
    expect(() => assertBindingIntegrity([binding({ winner: { kind: 'runtime-value-match', consumedValue: 'oklch(75% 0.15 50)' } })], [metadata()])).toThrow('lacks utility winner proof')
    expect(() => assertBindingIntegrity([binding({ winner: { kind: 'tailwind-utility', sourceUtility: 'text-red-400', activeClassToken: 'text-red-400', isolatedValue: 'oklch(75% 0.15 50)' } })], [metadata()])).toThrow('source mismatch')
    expect(() => assertBindingIntegrity([binding({ winner: { kind: 'tailwind-utility', sourceUtility: 'text-orange-400', activeClassToken: 'hover:text-orange-400', isolatedValue: 'rgb(1, 2, 3)' } })], [metadata()])).toThrow('computed mismatch')
  })
  it('maps gradient stops to computed Tailwind custom properties', () => {
    expect(tailwindComputedChannel('from')).toBe('--tw-gradient-from')
    expect(tailwindComputedChannel('via')).toBe('--tw-gradient-via')
    expect(tailwindComputedChannel('to')).toBe('--tw-gradient-to')
  })
  it('requires the exact active utility and its isolated computed value', () => {
    expect(isTailwindRuntimeWinner('text-red-400', ['text-text-muted'], 'rgb(94, 101, 115)', 'oklab(63.7% 0.237 25.331)')).toBe(false)
    expect(isTailwindRuntimeWinner('text-red-400', ['text-red-400'], 'rgb(94, 101, 115)', 'oklab(63.7% 0.237 25.331)')).toBe(false)
    expect(isTailwindRuntimeWinner('text-red-400', ['text-red-400'], 'oklab(63.7% 0.237 25.331)', 'oklab(63.7% 0.237 25.331)')).toBe(true)
    expect(isTailwindRuntimeWinner('text-red-400', ['dark:text-red-400'], 'oklab(63.7% 0.237 25.331)', 'oklab(63.7% 0.237 25.331)')).toBe(true)
  })
  it('isolates collection metadata to IDs declared by the current scenario', () => {
    expect(metadataForDeclaredIds([metadata(), metadata({ id: 'color-b' })], ['color-b']).map((item) => item.id)).toEqual(['color-b'])
  })
  it('maps and validates sandboxed HTML report base-style colors', () => {
    expect(htmlReportComputedProperty('ui/src/components/HtmlReportView.tsx', '#fff')).toBe('background-color')
    expect(htmlReportComputedProperty('ui/src/components/HtmlReportView.tsx', '#172033')).toBe('color')
    expect(htmlReportComputedProperty('ui/src/Other.tsx', '#fff')).toBeNull()
    const reportMetadata = metadata({ path: 'ui/src/components/HtmlReportView.tsx', sourceText: '#fff', syntaxKind: 'typescript-color-literal', channel: 'background-color' })
    const reportBinding = binding({
      surfaceKind: 'sandboxed-iframe', channel: 'background-color', actualValue: 'rgb(255, 255, 255)',
      winner: { kind: 'iframe-computed-style', sourceValue: '#fff', computedProperty: 'background-color', isolatedValue: 'rgb(255, 255, 255)' },
      target: { selector: 'iframe[title^="HTML report:"]', x: 10, y: 20, width: 300, height: 420 },
    })
    expect(() => assertBindingIntegrity([reportBinding], [reportMetadata])).not.toThrow()
    expect(() => assertBindingIntegrity([{ ...reportBinding, actualValue: 'rgb(1, 2, 3)' }], [reportMetadata])).toThrow('computed mismatch')
    expect(() => assertBindingIntegrity([{ ...reportBinding, winner: { kind: 'typed-runtime-value', consumedValue: '#fff' } }], [reportMetadata])).toThrow('lacks computed-style proof')
  })
})
