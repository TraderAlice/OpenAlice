import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import {
  sessionConfigFactory,
  sessionDeleteFactory,
  sessionInterruptFactory,
  sessionListFactory,
  sessionRestoreFactory,
  sessionShowFactory,
} from './session-tools.js'
import type { ZodType } from 'zod'

async function run(tool: Tool, args: Record<string, unknown> = {}) {
  return await tool.execute!(args, { toolCallId: 'test', messages: [] }) as Record<string, unknown>
}

const schema = (tool: Tool) => tool.inputSchema as unknown as ZodType

const base = {
  workspaceId: 'ws-research',
  workspaceLabel: 'Research',
  inboxStore: {} as never,
  entityStore: {} as never,
} satisfies WorkspaceToolContext

const directory = (sessions: Record<string, unknown>[]) =>
  ({ workspace: { id: 'ws-research', tag: 'Research' }, sessions }) as never

const sessions = [
  { resumeId: 'resume-a', agent: 'codex', presence: 'active' },
  { resumeId: 'resume-b', agent: 'claude' },
  { resumeId: 'resume-c', agent: 'codex', presence: 'deleted' },
]

const ctx = (extra: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext => ({
  ...base,
  sessionDirectory: async () => directory(sessions),
  sessionControl: {
    show: async (resumeId) => ({ resumeId, agent: 'codex' }),
    interrupt: async (resumeId) => ({ resumeId, stopped: true }),
    configure: async (input) => ({
      resumeId: input.resumeId,
      agent: 'codex',
      runtime: { model: input.model ?? null },
    }),
    setPresence: async (input) => ({ resumeId: input.resumeId, presence: input.presence }),
    unreadCount: (resumeId) => resumeId === 'resume-a' ? 3 : 0,
  },
  ...extra,
})

describe('session_list', () => {
  it('lists active sessions enriched with unread mailbox counts', async () => {
    const result = await run(sessionListFactory.build(ctx()), {})
    expect(result).toMatchObject({ ok: true, workspace: { id: 'ws-research' } })
    const rows = result['sessions'] as Record<string, unknown>[]
    expect(rows.map((r) => r['resumeId'])).toEqual(['resume-a', 'resume-b'])
    expect(rows[0]).toMatchObject({ unreadMailboxCount: 3 })
    expect(rows[1]).toMatchObject({ unreadMailboxCount: 0 })
  })
  it('coerces string limit flags from the CLI', () => {
    const tool = sessionListFactory.build(ctx())
    expect(schema(tool).safeParse({ limit: '10', state: 'deleted' })).toMatchObject({ success: true })
    expect(schema(tool).safeParse({ limit: '0' }).success).toBe(false)
    expect(schema(tool).safeParse({ limit: '101' }).success).toBe(false)
  })

  it('aggregates across workspaces from the workspace-manager context', async () => {
    const result = await run(sessionListFactory.build(ctx({
      workspaceId: 'workspace-manager',
      workspaceInventory: async () => [
        { id: 'ws-a', tag: 'A', createdAt: '2026-01-01', sessions: { total: 0, running: 0, recent: [] }, headlessRunning: 0 },
        { id: 'ws-b', tag: 'B', createdAt: '2026-01-01', sessions: { total: 0, running: 0, recent: [] }, headlessRunning: 0 },
      ],
      sessionDirectory: async (id) => directory(id === 'ws-a'
        ? [{ resumeId: 'resume-a', agent: 'codex', presence: 'active' }]
        : [{ resumeId: 'resume-d', agent: 'claude', presence: 'deleted' }]),
    })), {})
    const workspaces = result['workspaces'] as Record<string, unknown>[]
    expect(workspaces.map((w) => w['wsId'])).toEqual(['ws-a', 'ws-b'])
    expect((workspaces[0]!['sessions'] as unknown[])).toHaveLength(1)
    expect((workspaces[1]!['sessions'] as unknown[])).toHaveLength(0)
  })

  it('errors from workspace-manager without an inventory', async () => {
    const result = await run(sessionListFactory.build(ctx({ workspaceId: 'workspace-manager' })), {})
    expect(result).toMatchObject({ ok: false })
    expect(String(result['error'])).toContain('--ws-id')
  })

  it('errors when the directory is unavailable', async () => {
    expect(await run(sessionListFactory.build(base), {})).toMatchObject({
      ok: false,
      error: expect.stringContaining('unavailable'),
    })
  })
})

describe('session_show', () => {
  it('returns the control-plane detail', async () => {
    expect(await run(sessionShowFactory.build(ctx()), { resumeId: 'resume-a' }))
      .toMatchObject({ ok: true, session: { resumeId: 'resume-a', agent: 'codex' } })
  })

  it('reports unknown sessions', async () => {
    const tool = sessionShowFactory.build(ctx({
      sessionControl: { ...ctx().sessionControl!, show: async () => null },
    }))
    expect(await run(tool, { resumeId: 'resume-x' })).toMatchObject({
      ok: false,
      error: 'unknown Session: resume-x',
    })
  })
})

describe('session_interrupt', () => {
  it('returns the stop result', async () => {
    expect(await run(sessionInterruptFactory.build(ctx()), { resumeId: 'resume-a' }))
      .toMatchObject({ ok: true, resumeId: 'resume-a', stopped: true })
  })
})

describe('session_config', () => {
  it('rejects credential and credentialSource together', async () => {
    const result = await run(sessionConfigFactory.build(ctx()), {
      resumeId: 'resume-a',
      credential: 'vault-slug',
      credentialSource: 'native',
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('mutually exclusive') })
  })

  it('rejects an empty configuration', async () => {
    expect(await run(sessionConfigFactory.build(ctx()), { resumeId: 'resume-a' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('nothing to configure') })
  })

  it('applies a model change to an idle session', async () => {
    expect(await run(sessionConfigFactory.build(ctx()), { resumeId: 'resume-a', model: 'gpt-5' }))
      .toMatchObject({ ok: true, resumeId: 'resume-a', agent: 'codex', runtime: { model: 'gpt-5' } })
  })

  it('surfaces control-plane failures as errors', async () => {
    const tool = sessionConfigFactory.build(ctx({
      sessionControl: {
        ...ctx().sessionControl!,
        configure: async () => { throw new Error('session busy') },
      },
    }))
    expect(await run(tool, { resumeId: 'resume-a', model: 'gpt-5' }))
      .toMatchObject({ ok: false, error: 'session busy' })
  })
})

describe('session presence', () => {
  it('archives via session_delete', async () => {
    expect(await run(sessionDeleteFactory.build(ctx()), { resumeId: 'resume-a' }))
      .toMatchObject({ ok: true, resumeId: 'resume-a', presence: 'deleted' })
  })

  it('restores via session_restore', async () => {
    expect(await run(sessionRestoreFactory.build(ctx()), { resumeId: 'resume-c' }))
      .toMatchObject({ ok: true, resumeId: 'resume-c', presence: 'active' })
  })

  it('reports unknown sessions from setPresence failures', async () => {
    const tool = sessionDeleteFactory.build(ctx({
      sessionControl: {
        ...ctx().sessionControl!,
        setPresence: async () => { throw new Error('Unknown Session: resume-x') },
      },
    }))
    expect(await run(tool, { resumeId: 'resume-x' })).toMatchObject({ ok: false, error: 'Unknown Session: resume-x' })
  })
})
