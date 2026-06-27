import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createInboxStore,
  createMemoryInboxStore,
  type IInboxStore,
  type InboxEntry,
} from './inbox-store.js'

describe('InboxStore (in-memory)', () => {
  let store: IInboxStore

  beforeEach(() => {
    store = createMemoryInboxStore()
  })

  it('append with comments only succeeds', async () => {
    const before = Date.now()
    const entry = await store.append({
      workspaceId: 'ws-1',
      workspaceLabel: 'chat-with-kimi',
      comments: 'hey, can you check the SPY chart?',
    })
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.workspaceId).toBe('ws-1')
    expect(entry.comments).toBe('hey, can you check the SPY chart?')
    expect(entry.docs).toBeUndefined()
    expect(entry.ts).toBeGreaterThanOrEqual(before)
  })

  it('append with docs only succeeds', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      docs: [{ path: 'research/macro-2026-05-14.md' }],
    })
    expect(entry.docs).toEqual([{ path: 'research/macro-2026-05-14.md' }])
    expect(entry.comments).toBeUndefined()
  })

  it('append with both docs and comments succeeds', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      docs: [{ path: 'a.md' }, { path: 'b.md' }],
      comments: 'two reports, b is more interesting',
    })
    expect(entry.docs).toHaveLength(2)
    expect(entry.comments).toContain('two reports')
  })

  it('append persists an optional origin (additive, agent-invisible provenance)', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      comments: 'done',
      origin: { kind: 'headless', runId: 'task-9', issueId: 'macro-scan', agent: 'claude' },
    })
    expect(entry.origin).toEqual({
      kind: 'headless',
      runId: 'task-9',
      issueId: 'macro-scan',
      agent: 'claude',
    })
    const { entries } = await store.read({ workspaceId: 'ws-1' })
    expect(entries[0].origin?.issueId).toBe('macro-scan')
  })

  it('append without origin leaves it undefined (old-shape backward compatible)', async () => {
    const entry = await store.append({ workspaceId: 'ws-1', comments: 'no origin' })
    expect(entry.origin).toBeUndefined()
  })

  it('append rejects missing workspaceId', async () => {
    await expect(
      // @ts-expect-error — exercising runtime guard
      store.append({ comments: 'orphan' }),
    ).rejects.toThrow(/workspaceId is required/)
  })

  it('append rejects when both docs and comments are empty', async () => {
    await expect(
      store.append({ workspaceId: 'ws-1' }),
    ).rejects.toThrow(/at least one of docs or comments/)
    await expect(
      store.append({ workspaceId: 'ws-1', docs: [], comments: '   ' }),
    ).rejects.toThrow(/at least one of docs or comments/)
  })

  it('append rejects malformed doc entries', async () => {
    await expect(
      store.append({ workspaceId: 'ws-1', docs: [{ path: '' }] }),
    ).rejects.toThrow(/non-empty `path`/)
  })

  it('read returns entries newest-first', async () => {
    await store.append({ workspaceId: 'ws-1', comments: 'first' })
    await store.append({ workspaceId: 'ws-1', comments: 'second' })
    await store.append({ workspaceId: 'ws-1', comments: 'third' })
    const { entries, hasMore } = await store.read()
    expect(entries.map((e) => e.comments)).toEqual(['third', 'second', 'first'])
    expect(hasMore).toBe(false)
  })

  it('read respects limit and reports hasMore', async () => {
    for (let i = 0; i < 5; i++) await store.append({ workspaceId: 'ws-1', comments: `n${i}` })
    const { entries, hasMore } = await store.read({ limit: 3 })
    expect(entries.map((e) => e.comments)).toEqual(['n4', 'n3', 'n2'])
    expect(hasMore).toBe(true)
  })

  it('read filters by workspaceId', async () => {
    await store.append({ workspaceId: 'ws-a', comments: 'a1' })
    await store.append({ workspaceId: 'ws-b', comments: 'b1' })
    await store.append({ workspaceId: 'ws-a', comments: 'a2' })
    const { entries } = await store.read({ workspaceId: 'ws-a' })
    expect(entries.map((e) => e.comments)).toEqual(['a2', 'a1'])
  })

  it('read uses `before` cursor to paginate older', async () => {
    const e1 = await store.append({ workspaceId: 'ws-1', comments: 'first' })
    const e2 = await store.append({ workspaceId: 'ws-1', comments: 'second' })
    const e3 = await store.append({ workspaceId: 'ws-1', comments: 'third' })
    const { entries } = await store.read({ before: e3.id, limit: 100 })
    expect(entries.map((e) => e.id)).toEqual([e2.id, e1.id])
  })

  it('delete removes an entry and returns true; missing id returns false', async () => {
    const a = await store.append({ workspaceId: 'ws-1', comments: 'a' })
    await store.append({ workspaceId: 'ws-1', comments: 'b' })
    expect(await store.delete(a.id)).toBe(true)
    const { entries } = await store.read()
    expect(entries.map((e) => e.comments)).toEqual(['b'])
    expect(await store.delete('does-not-exist')).toBe(false)
    expect(await store.delete(a.id)).toBe(false)
  })

  it('onRemoved fires on successful delete, dispose stops further notifications', async () => {
    const seen: string[] = []
    const dispose = store.onRemoved((id) => seen.push(id))
    const a = await store.append({ workspaceId: 'ws-1', comments: 'a' })
    const b = await store.append({ workspaceId: 'ws-1', comments: 'b' })
    await store.delete(a.id)
    await store.delete(b.id)
    expect(seen).toEqual([a.id, b.id])
    dispose()
    const c = await store.append({ workspaceId: 'ws-1', comments: 'c' })
    await store.delete(c.id)
    expect(seen).toHaveLength(2)
  })

  it('onAppended fires on append, dispose stops further notifications', async () => {
    const seen: InboxEntry[] = []
    const dispose = store.onAppended((e) => seen.push(e))
    await store.append({ workspaceId: 'ws-1', comments: 'a' })
    await store.append({ workspaceId: 'ws-1', comments: 'b' })
    expect(seen).toHaveLength(2)
    dispose()
    await store.append({ workspaceId: 'ws-1', comments: 'c' })
    expect(seen).toHaveLength(2)
  })
})

describe('InboxStore (JSONL persistence)', () => {
  let dir: string
  let path: string
  let store: IInboxStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oa-inbox-'))
    path = join(dir, 'entries.jsonl')
    store = createInboxStore({ filePath: path })
  })

  it('persists across new store instances on the same file', async () => {
    await store.append({
      workspaceId: 'ws-1',
      docs: [{ path: 'report.md' }],
      comments: 'final draft',
    })
    const fresh = createInboxStore({ filePath: path })
    const { entries } = await fresh.read()
    expect(entries).toHaveLength(1)
    expect(entries[0].docs).toEqual([{ path: 'report.md' }])
    expect(entries[0].comments).toBe('final draft')
    await rm(dir, { recursive: true, force: true })
  })

  it('origin survives a JSONL round-trip; a legacy line (no origin) still parses', async () => {
    await store.append({
      workspaceId: 'ws-1',
      comments: 'with origin',
      origin: { kind: 'headless', runId: 'r1', issueId: 'i1', agent: 'opencode' },
    })
    // Simulate a pre-origin entry written by an older build (no `origin` key).
    const fs = await import('node:fs/promises')
    await fs.appendFile(
      path,
      JSON.stringify({ id: 'legacy', ts: 1, workspaceId: 'ws-1', comments: 'old' }) + '\n',
    )
    const fresh = createInboxStore({ filePath: path })
    const { entries } = await fresh.read()
    const legacy = entries.find((e) => e.id === 'legacy')
    const withOrigin = entries.find((e) => e.comments === 'with origin')
    expect(legacy?.origin).toBeUndefined()
    expect(withOrigin?.origin).toEqual({ kind: 'headless', runId: 'r1', issueId: 'i1', agent: 'opencode' })
    await rm(dir, { recursive: true, force: true })
  })

  it('returns empty when file does not exist', async () => {
    const missing = createInboxStore({ filePath: join(dir, 'absent.jsonl') })
    const { entries, hasMore } = await missing.read()
    expect(entries).toEqual([])
    expect(hasMore).toBe(false)
    await rm(dir, { recursive: true, force: true })
  })

  it('delete rewrites the JSONL atomically; missing entries do not corrupt the file', async () => {
    const a = await store.append({ workspaceId: 'ws-1', comments: 'a' })
    const b = await store.append({ workspaceId: 'ws-1', comments: 'b' })
    const c = await store.append({ workspaceId: 'ws-1', comments: 'c' })
    expect(await store.delete(b.id)).toBe(true)

    // Re-open from disk — verify only a and c survive, in original order.
    const fresh = createInboxStore({ filePath: path })
    const { entries } = await fresh.read()
    expect(entries.map((e) => e.id)).toEqual([c.id, a.id])

    // Deleting a non-existent id on disk is a no-op (returns false; file
    // contents unchanged).
    expect(await store.delete('does-not-exist')).toBe(false)
    const fresh2 = createInboxStore({ filePath: path })
    const { entries: again } = await fresh2.read()
    expect(again.map((e) => e.id)).toEqual([c.id, a.id])
    await rm(dir, { recursive: true, force: true })
  })

  it('delete leaves no tmp file on the side', async () => {
    const a = await store.append({ workspaceId: 'ws-1', comments: 'a' })
    await store.delete(a.id)
    const fs = await import('node:fs/promises')
    const entries = await fs.readdir(dir)
    expect(entries).toContain('entries.jsonl')
    expect(entries).not.toContain('entries.jsonl.tmp')
    await rm(dir, { recursive: true, force: true })
  })
})
