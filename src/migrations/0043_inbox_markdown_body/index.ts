import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Migration } from '../types.js'

/** Frozen shipped boundary. Do not import the evolving Inbox store/parser. */
export async function migrateInboxMarkdownBody(home: string): Promise<void> {
  const path = join(home, 'data', 'inbox', 'entries.jsonl')
  let source: string
  try { source = await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  let changed = false
  const lines = source.split('\n').map((line, index) => {
    if (!line.trim()) return line
    const entry = JSON.parse(line) as Record<string, unknown>
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid Inbox row ${index + 1}`)
    if (!Object.hasOwn(entry, 'docs') && !Object.hasOwn(entry, 'comments')) return line
    const { docs, comments, ...rest } = entry
    if (comments !== undefined && typeof comments !== 'string') throw new Error(`Invalid Inbox comments on row ${index + 1}`)
    if (docs !== undefined && !Array.isArray(docs)) throw new Error(`Invalid Inbox docs on row ${index + 1}`)
    const references: string[] = []
    const fileRevisions: Record<string, string> = {}
    for (const doc of (docs ?? []) as Array<{ path: string; revision?: string }>) {
      if (!doc || typeof doc.path !== 'string' || /[\r\n\[\]]/.test(doc.path)) throw new Error(`Invalid Inbox file on row ${index + 1}`)
      const relativePath = doc.path.includes('/') || /\.[a-z0-9]{1,16}$/i.test(doc.path) ? doc.path : `./${doc.path}`
      references.push(`[[${relativePath}]]`)
      if (doc.revision) fileRevisions[relativePath] = doc.revision
    }
    let prose = typeof rest.body === 'string' ? rest.body : comments ?? ''
    // A historical unfinished fence must not swallow appended file references.
    let fence: string | undefined
    for (const match of prose.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm)) {
      if (!fence) fence = match[1]
      else if (match[1]![0] === fence[0] && match[1]!.length >= fence.length && !match[2]!.trim()) fence = undefined
    }
    if (fence && references.length) prose += `\n${fence}`
    changed = true
    return JSON.stringify({ ...rest,
      body: [prose, ...references].filter(Boolean).join('\n\n'),
      ...(Object.keys(fileRevisions).length ? { fileRevisions } : {}),
    })
  })
  if (!changed) return
  // Parse every row before touching the file; malformed history must never be lost.
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, lines.join('\n'))
  await rename(temporary, path)
}

export const migration: Migration = {
  id: '0043_inbox_markdown_body', appVersion: '0.92.1', introducedAt: '2026-09-10',
  affects: ['data/inbox/entries.jsonl'],
  summary: 'Unify Inbox comments and file pointers into Markdown bodies, preserving provenance and published file revisions.',
  up: async ctx => migrateInboxMarkdownBody(ctx.userDataHome()),
}
