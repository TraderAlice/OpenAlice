/** Connector-owned extensions. Unknown/unresolved references remain literal. */
export interface ReplyReference { path: string; start: number; end: number }
export type ReplyMedia = 'file' | 'image' | 'sticker'

export function replyMedia(path: string): ReplyMedia {
  if (/^sticker\/.+\.(png|webp)$/i.test(path)) return 'sticker'
  if (/\.(png|jpe?g|webp)$/i.test(path)) return 'image'
  return 'file'
}

export function parseReplyDirectives(text: string): { references: ReplyReference[]; silent: boolean } {
  const references: ReplyReference[] = []
  let silent = false
  // Consume literal code and escapes before dispatching double-bracket extensions.
  const scan = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?:\n|$)|$)|(`+)[\s\S]*?\2|\\\[\[|\[\[([^\]\n]+)\]\]/g
  for (const match of text.matchAll(scan)) {
    const value = match[3]?.trim()
    if (!value) continue
    if (value === 'no-reply') { silent = true; continue }
    // File-shaped relative references only; ordinary wiki links are not file requests.
    if (!/^[^:|#?\\\x00]+\.[a-z0-9]{1,16}$/i.test(value) || value.startsWith('/') || value.split('/').includes('..')) continue
    references.push({ path: value, start: match.index, end: match.index + match[0].length })
  }
  return { references, silent }
}

export function renderReplyReferences(text: string, references: ReplyReference[], resolved: ReadonlySet<string>): string {
  let result = text
  for (const reference of [...references].reverse()) {
    if (resolved.has(reference.path)) result = result.slice(0, reference.start) + result.slice(reference.end)
  }
  return result.trim()
}
