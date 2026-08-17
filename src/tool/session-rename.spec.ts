import { describe, expect, it, vi } from 'vitest'

import type { Tool } from 'ai'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { ResumePresenceError } from '../workspaces/resume-registry.js'
import { SessionDisplayNameError } from '../workspaces/session-runtime-store.js'
import { sessionRenameFactory } from './session-rename.js'

function ctx(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-self',
    workspaceLabel: 'research',
    inboxStore: {} as never,
    entityStore: {} as never,
    ...over,
  }
}

async function run(tool: Tool, args: Record<string, unknown>) {
  return (await tool.execute!(args, { toolCallId: 't', messages: [] })) as Record<string, unknown> & {
    ok: boolean
    error?: string
    displayName?: string
  }
}

describe('session_rename', () => {
  it('renames a Session in this Workspace', async () => {
    const setSessionDisplayName = vi.fn(async (input: { resumeId: string; displayName: string | null }) => ({
      resumeId: input.resumeId,
      displayName: 'AAPL desk',
    }))
    const res = await run(sessionRenameFactory.build(ctx({ setSessionDisplayName })), {
      resumeId: 'resume-kind-owl-abc123',
      displayName: 'AAPL desk',
    })
    expect(res).toEqual({
      ok: true,
      resumeId: 'resume-kind-owl-abc123',
      displayName: 'AAPL desk',
    })
    expect(setSessionDisplayName).toHaveBeenCalledWith({
      resumeId: 'resume-kind-owl-abc123',
      displayName: 'AAPL desk',
    })
  })

  it('clears the nametag', async () => {
    const setSessionDisplayName = vi.fn(async (input: { resumeId: string; displayName: string | null }) => ({
      resumeId: input.resumeId,
    }))
    const res = await run(sessionRenameFactory.build(ctx({ setSessionDisplayName })), {
      resumeId: 'resume-kind-owl-abc123',
      displayName: '',
    })
    expect(res).toEqual({ ok: true, resumeId: 'resume-kind-owl-abc123' })
    expect(setSessionDisplayName).toHaveBeenCalledWith({
      resumeId: 'resume-kind-owl-abc123',
      displayName: '',
    })
  })

  it('surfaces a missing Session as a tool error', async () => {
    const res = await run(sessionRenameFactory.build(ctx({
      setSessionDisplayName: async () => {
        throw new ResumePresenceError('not_found', 'resume conversation not found')
      },
    })), {
      resumeId: 'resume-missing',
      displayName: 'Ghost',
    })
    expect(res).toEqual({ ok: false, error: 'resume conversation not found' })
  })

  it('surfaces an overlong nametag as a tool error', async () => {
    const res = await run(sessionRenameFactory.build(ctx({
      setSessionDisplayName: async () => {
        throw new SessionDisplayNameError('too_long', 'displayName must be at most 120 characters')
      },
    })), {
      resumeId: 'resume-kind-owl-abc123',
      displayName: 'x'.repeat(120),
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/at most 120/)
  })
})
