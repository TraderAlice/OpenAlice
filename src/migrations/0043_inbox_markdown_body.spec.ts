import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { migrateInboxMarkdownBody } from './0043_inbox_markdown_body/index.js'

describe('Inbox Markdown migration', () => {
  it('preserves identity, origin, read state and revisions; a second run does nothing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'inbox-migration-'))
    try {
      const dir = join(home, 'data/inbox'); await mkdir(dir, { recursive: true })
      const path = join(dir, 'entries.jsonl')
      const original = { id: 'one', ts: 123, workspaceId: 'source', origin: { kind: 'manual' }, comments: '# Report\n\nDone.', docs: [{ path: 'report/a.pdf', revision: 'sha256:abc' }] }
      await writeFile(path, JSON.stringify(original) + '\n')
      await writeFile(join(dir, 'read-state.json'), '{"version":1,"read":{"one":456}}')
      await migrateInboxMarkdownBody(home)
      const migrated = await readFile(path, 'utf8')
      expect(JSON.parse(migrated)).toEqual({ id: 'one', ts: 123, workspaceId: 'source', origin: { kind: 'manual' }, body: '# Report\n\nDone.\n\n[[report/a.pdf]]', fileRevisions: { 'report/a.pdf': 'sha256:abc' } })
      await migrateInboxMarkdownBody(home)
      expect(await readFile(path, 'utf8')).toBe(migrated)
      expect(await readFile(join(dir, 'read-state.json'), 'utf8')).toBe('{"version":1,"read":{"one":456}}')
      await writeFile(path, JSON.stringify({ ...original, comments: '```text\nA note', docs: [{ path: 'README', revision: 'sha256:readme' }] }) + '\n')
      await migrateInboxMarkdownBody(home)
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ body: '```text\nA note\n```\n\n[[./README]]', fileRevisions: { './README': 'sha256:readme' } })
      await writeFile(path, JSON.stringify(original) + '\n{broken\n')
      const malformed = await readFile(path, 'utf8')
      await expect(migrateInboxMarkdownBody(home)).rejects.toThrow()
      expect(await readFile(path, 'utf8')).toBe(malformed)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
})
