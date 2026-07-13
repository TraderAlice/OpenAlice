import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { workspaceSessionsFactory } from './workspace-sessions.js'

async function run(tool: Tool, args: Record<string, unknown>) {
  return tool.execute!(args, { toolCallId: 't', messages: [] })
}

describe('workspace_sessions', () => {
  it('returns the safe directory for a known workspace', async () => {
    const sessionDirectory = vi.fn(async () => ({
      workspace: { id: 'peer', tag: 'research' },
      sessions: [{
        resumeId: 'resume-kind-owl-abc123', agent: 'pi', createdAt: 1, updatedAt: 2,
        lifecycle: 'active' as const, resumable: true, active: false,
      }],
    }))
    const ctx = {
      workspaceId: 'self',
      workspaceLabel: 'self',
      inboxStore: {} as never,
      entityStore: {} as never,
      resolveWorkspace: (id: string) => id === 'peer' ? { id, tag: 'research', dir: '/peer' } : null,
      sessionDirectory,
    } satisfies WorkspaceToolContext

    const result = await run(workspaceSessionsFactory.build(ctx), { id: 'peer' })
    expect(result).toMatchObject({ ok: true, workspace: { id: 'peer' } })
    expect(sessionDirectory).toHaveBeenCalledWith('peer', undefined)
  })
})
