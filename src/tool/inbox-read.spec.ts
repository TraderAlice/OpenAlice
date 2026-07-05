import { describe, it, expect } from 'vitest'
import type { Tool } from 'ai'
import { inboxReadFactory } from './inbox-read.js'
import { createMemoryInboxStore } from '../core/inbox-store.js'
import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'

const WS = 'ws-self'
const OTHER = 'ws-other'

async function run(tool: Tool, args: Record<string, unknown>) {
  return (await tool.execute!(args, { toolCallId: 't', messages: [] })) as {
    ok: boolean
    count: number
    hasMore: boolean
    entries: Array<{
      id: string
      ts: string
      mine: boolean
      workspaceId: string
      workspace: string
      comments?: string
      docs: string[]
    }>
  }
}

async function seeded(): Promise<WorkspaceToolContext> {
  const inboxStore = createMemoryInboxStore()
  await inboxStore.append({ workspaceId: WS, workspaceLabel: 'Mine', docs: [{ path: 'a.md' }], comments: 'first' })
  await inboxStore.append({ workspaceId: OTHER, workspaceLabel: 'Theirs', comments: 'from elsewhere' })
  await inboxStore.append({ workspaceId: WS, workspaceLabel: 'Mine', docs: [{ path: 'b.md' }, { path: 'c.md' }] })
  return { workspaceId: WS, workspaceLabel: 'Mine', inboxStore, entityStore: {} as never }
}

describe('inbox_read', () => {
  it('returns all entries newest-first with a correct `mine` flag', async () => {
    const tool = inboxReadFactory.build(await seeded())
    const res = await run(tool, {})
    expect(res.ok).toBe(true)
    expect(res.count).toBe(3)
    // newest first: the second self-push, then the foreign one, then the first
    expect(res.entries.map((e) => e.mine)).toEqual([true, false, true])
    expect(res.entries[1].workspace).toBe('Theirs')
  })

  it('`self` narrows to this workspace and surfaces its doc paths', async () => {
    const tool = inboxReadFactory.build(await seeded())
    const res = await run(tool, { self: true })
    expect(res.count).toBe(2)
    expect(res.entries.every((e) => e.mine)).toBe(true)
    // newest self entry carries both attachments, as plain relative paths
    expect(res.entries[0].docs).toEqual(['b.md', 'c.md'])
    expect(res.entries[1].docs).toEqual(['a.md'])
  })

  it('surfaces the dir-resolvable workspaceId on every entry (the peer-path handle)', async () => {
    const tool = inboxReadFactory.build(await seeded())
    const res = await run(tool, {})
    // the foreign entry exposes OTHER's id so the agent can feed it to peer path
    const foreign = res.entries.find((e) => !e.mine)
    expect(foreign?.workspaceId).toBe(OTHER)
    // self entries carry this workspace's own id
    expect(res.entries.filter((e) => e.mine).every((e) => e.workspaceId === WS)).toBe(true)
  })

  it('`limit` caps the newest-first window and reports hasMore', async () => {
    const tool = inboxReadFactory.build(await seeded())
    const res = await run(tool, { limit: 1 })
    expect(res.count).toBe(1)
    expect(res.hasMore).toBe(true)
    expect(res.entries[0].mine).toBe(true)
  })

  it('emits an ISO timestamp string', async () => {
    const tool = inboxReadFactory.build(await seeded())
    const res = await run(tool, {})
    expect(res.entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  })
})
