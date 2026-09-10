/** Shared Markdown extensions. Resolution and delivery belong to the consumer. */
export interface ContentReference { path: string; start: number; end: number }

export function isFileReference(path: string): boolean {
  return /^[^:|#?\\\x00\r\n\[\]]+$/.test(path) && (path.includes('/') || /\.[a-z0-9]{1,16}$/i.test(path))
    && !path.startsWith('/') && !path.split('/').includes('..')
}

export function parseContentReferences(text: string): { references: ContentReference[]; silent: boolean } {
  const references: ContentReference[] = []
  let silent = false
  const scan = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?:\n|$)|$)|(`+)[\s\S]*?\2|\\\[\[|\[\[([^\]\n]+)\]\]/g
  for (const match of text.matchAll(scan)) {
    const path = match[3]?.trim()
    if (!path) continue
    if (path === 'no-reply') { silent = true; continue }
    if (isFileReference(path)) references.push({ path, start: match.index, end: match.index + match[0].length })
  }
  return { references, silent }
}

/** Derived file index, never a second authoring field. First occurrence wins. */
export function inboxFiles(entry: { body: string; fileRevisions?: Readonly<Record<string, string>> }): Array<{ path: string; revision?: string }> {
  return [...new Set(parseContentReferences(entry.body).references.map(ref => ref.path))]
    .map(path => ({ path, ...(entry.fileRevisions?.[path] ? { revision: entry.fileRevisions[path] } : {}) }))
}
