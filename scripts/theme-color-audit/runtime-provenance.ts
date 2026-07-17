import type { RuntimeColorBinding } from './types.js'

export interface RuntimeBindingMetadata {
  readonly id: string
  readonly path: string
  readonly sourceText: string
  readonly syntaxKind: string
  readonly channel: string
  readonly selector?: string
}

export function tailwindComputedChannel(channel: string): string | null {
  return ({
    bg: 'background-color', text: 'color', border: 'border-color', fill: 'fill', stroke: 'stroke',
    from: '--tw-gradient-from', via: '--tw-gradient-via', to: '--tw-gradient-to',
  } as Record<string, string>)[channel] ?? null
}

export function isTailwindRuntimeWinner(sourceText: string, classTokens: readonly string[], actualValue: string, isolatedUtilityValue: string): boolean {
  return classTokens.some((token) => token === sourceText || token.endsWith(`:${sourceText}`)) && actualValue.trim() !== '' && actualValue.trim() === isolatedUtilityValue.trim()
}

export function isCssColor(value: string): boolean {
  if (!value.trim()) return false
  return /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)]*\)|transparent|currentcolor)$/i.test(value.trim())
}

export function htmlReportComputedProperty(path: string, sourceText: string): 'background-color' | 'color' | null {
  if (path !== 'ui/src/components/HtmlReportView.tsx') return null
  if (sourceText.toLowerCase() === '#fff') return 'background-color'
  if (sourceText.toLowerCase() === '#172033') return 'color'
  return null
}

export function assertEveryTarget(ids: readonly string[], bindings: readonly RuntimeColorBinding[], label: string): void {
  const bound = new Set(bindings.filter((entry) => entry.target.width > 0 && entry.target.height > 0).map((entry) => entry.inventoryId))
  const missing = ids.filter((id) => !bound.has(id))
  if (missing.length) throw new Error(`${label}: missing runtime targets (${missing.length}):\n${missing.join('\n')}`)
}

export function assertBindingIntegrity(bindings: readonly RuntimeColorBinding[], metadata: readonly RuntimeBindingMetadata[]): void {
  const byId = new Map(metadata.map((item) => [item.id, item]))
  for (const binding of bindings) {
    if (binding.target.width <= 0 || binding.target.height <= 0) throw new Error(`zero-area runtime target: ${binding.inventoryId}`)
    if (binding.surfaceKind === 'dom-element' && ['#root', 'body', 'html'].includes(binding.target.selector)) throw new Error(`page-root runtime target: ${binding.inventoryId} (${binding.target.selector})`)
    const item = byId.get(binding.inventoryId)
    if (item?.syntaxKind === 'tailwind-palette-utility' && binding.actualValue === item.sourceText) {
      throw new Error(`Tailwind source text used as runtime value: ${binding.inventoryId} (${binding.actualValue})`)
    }
    if (item?.syntaxKind === 'tailwind-palette-utility') {
      if (binding.winner.kind !== 'tailwind-utility') throw new Error(`Tailwind binding lacks utility winner proof: ${binding.inventoryId}`)
      if (binding.winner.sourceUtility !== item.sourceText) throw new Error(`Tailwind winner source mismatch: ${binding.inventoryId}`)
      if (!(binding.winner.activeClassToken === item.sourceText || binding.winner.activeClassToken.endsWith(`:${item.sourceText}`))) throw new Error(`Tailwind winner class mismatch: ${binding.inventoryId}`)
      if (binding.actualValue.trim() === '' || binding.actualValue.trim() !== binding.winner.isolatedValue.trim()) throw new Error(`Tailwind winner computed mismatch: ${binding.inventoryId}`)
    }
    if (binding.surfaceKind === 'sandboxed-iframe') {
      if (binding.winner.kind !== 'iframe-computed-style') throw new Error(`sandboxed iframe binding lacks computed-style proof: ${binding.inventoryId}`)
      const property = item ? htmlReportComputedProperty(item.path, item.sourceText) : null
      if (!item || property === null) throw new Error(`sandboxed iframe binding has unsupported source: ${binding.inventoryId}`)
      if (binding.winner.sourceValue !== item.sourceText || binding.winner.computedProperty !== property) throw new Error(`sandboxed iframe winner source mismatch: ${binding.inventoryId}`)
      if (!isCssColor(binding.actualValue) || binding.actualValue.trim() !== binding.winner.isolatedValue.trim()) throw new Error(`sandboxed iframe computed mismatch: ${binding.inventoryId}`)
    }
  }
}

export function metadataForDeclaredIds(metadata: readonly RuntimeBindingMetadata[], inventoryIds: readonly string[]): RuntimeBindingMetadata[] {
  const declared = new Set(inventoryIds)
  return metadata.filter((item) => declared.has(item.id))
}
