import { parseMarketReference } from '@traderalice/connector-protocol'
/** Connector-owned extensions. Unknown/unresolved references remain literal. */
export interface ReplyReference { path: string; start: number; end: number }
export type ReplyMedia = 'file' | 'image' | 'sticker'

export function replyMedia(path: string): ReplyMedia {
  if (parseMarketReference(path)) return 'image'
  if (/^sticker\/.+\.(png|webp)$/i.test(path)) return 'sticker'
  if (/\.(png|jpe?g|webp)$/i.test(path)) return 'image'
  return 'file'
}

export { parseContentReferences as parseReplyDirectives } from '@traderalice/connector-protocol'

export function renderReplyReferences(text: string, references: ReplyReference[], resolved: ReadonlySet<string>): string {
  let result = text
  for (const reference of [...references].reverse()) {
    if (resolved.has(reference.path)) result = result.slice(0, reference.start) + result.slice(reference.end)
  }
  return result.trim()
}
