import { inboxFiles } from '@traderalice/connector-protocol'
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
      body: 'hey, can you check the SPY chart?'
    })
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.workspaceId).toBe('ws-1')
    expect(entry.body).toBe('hey, can you check the SPY chart?')
    expect(inboxFiles(entry)).toEqual([])
    expect(entry.ts).toBeGreaterThanOrEqual(before)
  })

  it('append with docs only succeeds', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      body: "[[research/macro-2026-05-14.md]]"
    })
    expect(inboxFiles(entry)).toEqual([{ path: 'research/macro-2026-05-14.md' }])
    expect(entry.body).toBe('[[research/macro-2026-05-14.md]]')
  })

  it('append with both docs and comments succeeds', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      body: "two reports, b is more interesting\n\n[[a.md]]\n\n[[b.md]]"
    })
    expect(inboxFiles(entry)).toHaveLength(2)
    expect(entry.body).toContain('two reports')
  })

  it('append persists an optional origin (additive, agent-invisible provenance)', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      origin: { kind: 'headless', runId: 'task-9', issueId: 'macro-scan', agent: 'claude' },
      body: 'done'
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
    const entry = await store.append({
      workspaceId: 'ws-1',
      body: 'no origin'
    })
    expect(entry.origin).toBeUndefined()
  })

  it('append rejects missing workspaceId', async () => {
    await expect(
      // @ts-expect-error — exercising runtime guard
      store.append({ body: 'orphan' }),
    ).rejects.toThrow(/workspaceId is required/)
  })

  it('rejects missing and blank bodies', async () => {
    // @ts-expect-error exercising runtime validation
    await expect(store.append({ workspaceId: 'ws-1' })).rejects.toThrow(/body/)
    await expect(store.append({ workspaceId: 'ws-1', body: '   ' })).rejects.toThrow(/body/)
  })

  it('read returns entries newest-first', async () => {
    await store.append({
      workspaceId: 'ws-1',
      body: 'first'
    })
    await store.append({
      workspaceId: 'ws-1',
      body: 'second'
    })
    await store.append({
      workspaceId: 'ws-1',
      body: 'third'
    })
    const { entries, hasMore } = await store.read()
    expect(entries.map((e) => e.body)).toEqual(['third', 'second', 'first'])
    expect(hasMore).toBe(false)
  })

  it('read respects limit and reports hasMore', async () => {
    for (let i = 0; i < 5; i++) await store.append({
      workspaceId: 'ws-1',
      body: `n${i}`
    })
    const { entries, hasMore } = await store.read({ limit: 3 })
    expect(entries.map((e) => e.body)).toEqual(['n4', 'n3', 'n2'])
    expect(hasMore).toBe(true)
  })

  it('read filters by workspaceId', async () => {
    await store.append({
      workspaceId: 'ws-a',
      body: 'a1'
    })
    await store.append({
      workspaceId: 'ws-b',
      body: 'b1'
    })
    await store.append({
      workspaceId: 'ws-a',
      body: 'a2'
    })
    const { entries } = await store.read({ workspaceId: 'ws-a' })
    expect(entries.map((e) => e.body)).toEqual(['a2', 'a1'])
  })

  it('read uses `before` cursor to paginate older', async () => {
    const e1 = await store.append({
      workspaceId: 'ws-1',
      body: 'first'
    })
    const e2 = await store.append({
      workspaceId: 'ws-1',
      body: 'second'
    })
    const e3 = await store.append({
      workspaceId: 'ws-1',
      body: 'third'
    })
    const { entries } = await store.read({ before: e3.id, limit: 100 })
    expect(entries.map((e) => e.id)).toEqual([e2.id, e1.id])
  })

  it('read can limit itself to unread entries', async () => {
    const read = await store.append({
      workspaceId: 'ws-1',
      body: 'seen'
    })
    await store.append({
      workspaceId: 'ws-1',
      body: 'fresh'
    })
    await store.markRead(read.id)
    const { entries, hasMore } = await store.read({ unread: true })
    expect(entries.map((entry) => entry.body)).toEqual(['fresh'])
    expect(hasMore).toBe(false)
  })

  it('gets one entry directly by its immutable id', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      body: 'find me'
    })
    expect(await store.get(entry.id)).toMatchObject({
      id: entry.id,
      body: 'find me'
    })
    expect(await store.get('missing')).toBeNull()
  })

  it('includes the durable read receipt in a direct lookup', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      body: 'find my receipt'
    })
    await store.markRead(entry.id, 1234)

    expect(await store.get(entry.id)).toMatchObject({ id: entry.id, readAt: 1234 })

    await store.markUnread(entry.id)
    expect(await store.get(entry.id)).not.toHaveProperty('readAt')
  })

  it('delete removes an entry and returns true; missing id returns false', async () => {
    const a = await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    await store.append({
      workspaceId: 'ws-1',
      body: 'b'
    })
    expect(await store.delete(a.id)).toBe(true)
    const { entries } = await store.read()
    expect(entries.map((e) => e.body)).toEqual(['b'])
    expect(await store.delete('does-not-exist')).toBe(false)
    expect(await store.delete(a.id)).toBe(false)
  })

  it('markRead and markUnread update per-entry readAt state', async () => {
    const a = await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    expect(await store.markRead(a.id, 1234)).toBe(true)
    let result = await store.read()
    expect(result.entries[0].readAt).toBe(1234)

    expect(await store.markUnread(a.id)).toBe(true)
    result = await store.read()
    expect(result.entries[0].readAt).toBeUndefined()
  })

  it('markRead and markUnread return false for missing entries', async () => {
    expect(await store.markRead('missing')).toBe(false)
    expect(await store.markUnread('missing')).toBe(false)
  })

  it('onRemoved fires on successful delete, dispose stops further notifications', async () => {
    const seen: string[] = []
    const dispose = store.onRemoved((id) => seen.push(id))
    const a = await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    const b = await store.append({
      workspaceId: 'ws-1',
      body: 'b'
    })
    await store.delete(a.id)
    await store.delete(b.id)
    expect(seen).toEqual([a.id, b.id])
    dispose()
    const c = await store.append({
      workspaceId: 'ws-1',
      body: 'c'
    })
    await store.delete(c.id)
    expect(seen).toHaveLength(2)
  })

  it('onAppended fires on append, dispose stops further notifications', async () => {
    const seen: InboxEntry[] = []
    const dispose = store.onAppended((e) => seen.push(e))
    await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    await store.append({
      workspaceId: 'ws-1',
      body: 'b'
    })
    expect(seen).toHaveLength(2)
    dispose()
    await store.append({
      workspaceId: 'ws-1',
      body: 'c'
    })
    expect(seen).toHaveLength(2)
  })
})

describe('InboxStore (JSONL persistence)', () => {
  let dir: string
  let path: string
  let readStatePath: string
  let store: IInboxStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oa-inbox-'))
    path = join(dir, 'entries.jsonl')
    readStatePath = join(dir, 'read-state.json')
    store = createInboxStore({ filePath: path, readStatePath })
  })

  it('persists across new store instances on the same file', async () => {
    await store.append({
      workspaceId: 'ws-1',
      body: "final draft\n\n[[report.md]]"
    })
    const fresh = createInboxStore({ filePath: path, readStatePath })
    const { entries } = await fresh.read()
    expect(entries).toHaveLength(1)
    expect(inboxFiles(entries[0])).toEqual([{ path: 'report.md' }])
    expect(entries[0].body).toBe('final draft\n\n[[report.md]]')
    await rm(dir, { recursive: true, force: true })
  })

  it('gets a persisted entry directly by id', async () => {
    const entry = await store.append({
      workspaceId: 'ws-1',
      body: 'find me'
    })
    const fresh = createInboxStore({ filePath: path, readStatePath })
    expect(await fresh.get(entry.id)).toMatchObject({
      id: entry.id,
      body: 'find me'
    })
    expect(await fresh.get('missing')).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })

  it('origin survives a JSONL round-trip; a legacy line (no origin) still parses', async () => {
    await store.append({
      workspaceId: 'ws-1',
      origin: { kind: 'headless', runId: 'r1', issueId: 'i1', agent: 'opencode' },
      body: 'with origin'
    })
    // Simulate a pre-origin entry written by an older build (no `origin` key).
    const fs = await import('node:fs/promises')
    await fs.appendFile(
      path,
      JSON.stringify({
        id: 'legacy',
        ts: 1,
        workspaceId: 'ws-1',
        body: 'old'
      }) + '\n',
    )
    const fresh = createInboxStore({ filePath: path, readStatePath })
    const { entries } = await fresh.read()
    const legacy = entries.find((e) => e.id === 'legacy')
    const withOrigin = entries.find((e) => e.body === 'with origin')
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
    const a = await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    const b = await store.append({
      workspaceId: 'ws-1',
      body: 'b'
    })
    const c = await store.append({
      workspaceId: 'ws-1',
      body: 'c'
    })
    expect(await store.delete(b.id)).toBe(true)

    // Re-open from disk — verify only a and c survive, in original order.
    const fresh = createInboxStore({ filePath: path, readStatePath })
    const { entries } = await fresh.read()
    expect(entries.map((e) => e.id)).toEqual([c.id, a.id])

    // Deleting a non-existent id on disk is a no-op (returns false; file
    // contents unchanged).
    expect(await store.delete('does-not-exist')).toBe(false)
    const fresh2 = createInboxStore({ filePath: path, readStatePath })
    const { entries: again } = await fresh2.read()
    expect(again.map((e) => e.id)).toEqual([c.id, a.id])
    await rm(dir, { recursive: true, force: true })
  })

  it('persists read state in a sidecar file without mutating entries JSONL', async () => {
    const a = await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    await store.markRead(a.id, 4567)

    const fs = await import('node:fs/promises')
    const entryLine = (await fs.readFile(path, 'utf-8')).trim()
    expect(JSON.parse(entryLine)).not.toHaveProperty('readAt')

    const fresh = createInboxStore({ filePath: path, readStatePath })
    const { entries } = await fresh.read()
    expect(entries[0].readAt).toBe(4567)
    expect(await fresh.get(a.id)).toMatchObject({ id: a.id, readAt: 4567 })
    expect(JSON.parse(await fs.readFile(readStatePath, 'utf-8'))).toEqual({
      version: 1,
      read: { [a.id]: 4567 },
    })
    await rm(dir, { recursive: true, force: true })
  })

  it('serializes concurrent read-state writes so marks do not clobber each other', async () => {
    const entries = await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.append({
        workspaceId: 'ws-1',
        body: `n${i}`
      })),
    )
    await Promise.all(entries.map((entry, i) => store.markRead(entry.id, 1000 + i)))

    const fresh = createInboxStore({ filePath: path, readStatePath })
    const { entries: readBack } = await fresh.read()
    expect(readBack.map((entry) => entry.readAt).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 8 }, (_, i) => 1000 + i),
    )
    await rm(dir, { recursive: true, force: true })
  })

  it('delete removes the entry and its sidecar read marker', async () => {
    const a = await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    await store.markRead(a.id, 999)
    expect(await store.delete(a.id)).toBe(true)

    const fresh = createInboxStore({ filePath: path, readStatePath })
    const { entries } = await fresh.read()
    expect(entries).toEqual([])

    const fs = await import('node:fs/promises')
    expect(JSON.parse(await fs.readFile(readStatePath, 'utf-8'))).toEqual({
      version: 1,
      read: {},
    })
    await rm(dir, { recursive: true, force: true })
  })

  it('delete leaves no tmp file on the side', async () => {
    const a = await store.append({
      workspaceId: 'ws-1',
      body: 'a'
    })
    await store.delete(a.id)
    const fs = await import('node:fs/promises')
    const entries = await fs.readdir(dir)
    expect(entries).toContain('entries.jsonl')
    expect(entries).not.toContain('entries.jsonl.tmp')
    await rm(dir, { recursive: true, force: true })
  })
})
