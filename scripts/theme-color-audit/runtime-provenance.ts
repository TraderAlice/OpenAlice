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

export function isCssColor(value: string): boolean {
  if (!value.trim()) return false
  return /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)]*\)|transparent|currentcolor)$/i.test(value.trim())
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
  }
}

export function metadataForDeclaredIds(metadata: readonly RuntimeBindingMetadata[], inventoryIds: readonly string[]): RuntimeBindingMetadata[] {
  const declared = new Set(inventoryIds)
  return metadata.filter((item) => declared.has(item.id))
}
