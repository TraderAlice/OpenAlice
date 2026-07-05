import { describe, it, expect } from 'vitest'
import type { Tool } from 'ai'
import { workspacePathFactory } from './workspace-path.js'
import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'

const PEERS: Record<string, { id: string; dir: string; tag: string }> = {
  'ws-peer': { id: 'ws-peer', dir: '/root/.openalice/workspaces/ws-peer', tag: 'Quant Lab' },
}

function ctx(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-self',
    workspaceLabel: 'Mine',
    inboxStore: {} as never,
    entityStore: {} as never,
    resolveWorkspace: (id) => PEERS[id] ?? null,
    ...over,
  }
}

async function run(tool: Tool, args: Record<string, unknown>) {
  return (await tool.execute!(args, { toolCallId: 't', messages: [] })) as
    | { ok: true; id: string; tag: string; path: string }
    | { ok: false; error: string }
}

describe('workspace_path', () => {
  it('resolves a known peer id to its absolute dir + tag', async () => {
    const res = await run(workspacePathFactory.build(ctx()), { id: 'ws-peer' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.path).toBe('/root/.openalice/workspaces/ws-peer')
      expect(res.tag).toBe('Quant Lab')
      expect(res.id).toBe('ws-peer')
    }
  })

  it('errors cleanly on an unknown workspace id (never throws)', async () => {
    const res = await run(workspacePathFactory.build(ctx()), { id: 'ws-ghost' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/unknown workspace/)
  })

  it('errors cleanly when no resolver is wired (e.g. service not started)', async () => {
    const res = await run(workspacePathFactory.build(ctx({ resolveWorkspace: undefined })), { id: 'ws-peer' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/unavailable/)
  })
})
