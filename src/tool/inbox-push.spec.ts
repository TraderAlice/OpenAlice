import type { Tool } from 'ai'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { inboxPushFactory, reportContentRevision } from './inbox-push.js'

async function run(tool: Tool, args: Record<string, unknown>) {
  return tool.execute!(args, { toolCallId: 'test', messages: [] })
}

function context(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-1',
    workspaceLabel: 'desk',
    inboxStore: {
      append: vi.fn(async (input) => ({ ...input, id: 'entry-1', ts: 123 })),
    } as never,
    entityStore: {} as never,
    ...over,
  }
}

describe('inbox_push provenance', () => {
  it('stamps the exact published report revision onto Inbox and provenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-report-revision-'))
    try {
      await mkdir(join(dir, 'research'), { recursive: true })
      await writeFile(join(dir, 'research', 'a.md'), '# Published\n', 'utf8')
      const appendInbox = vi.fn(async (input) => ({ ...input, id: 'entry-1', ts: 123 }))
      const appendProvenance = vi.fn(async (input) => ({ id: 'p-1', ...input }))
      const ctx = context({
        inboxStore: { append: appendInbox } as never,
        provenanceStore: { append: appendProvenance, list: vi.fn(), latest: vi.fn() },
        resolveWorkspace: () => ({ id: 'ws-1', tag: 'desk', dir }),
      })

      await run(inboxPushFactory.build(ctx), { docs: [{ path: 'research/a.md' }] })
      const revision = reportContentRevision('# Published\n')
      expect(appendInbox).toHaveBeenCalledWith(expect.objectContaining({
        docs: [{ path: 'research/a.md', revision }],
      }))
      expect(appendProvenance).toHaveBeenCalledWith(expect.objectContaining({
        artifact: { kind: 'report', workspaceId: 'ws-1', path: 'research/a.md', revision },
      }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records the notification and published report against the caller Session', async () => {
    const append = vi.fn(async (input) => ({ id: `p-${input.action}`, ...input }))
    const ctx = context({
      provenanceStore: { append, list: vi.fn(), latest: vi.fn() },
      origin: {
        kind: 'headless',
        runId: 'task-1',
        resumeId: 'resume-1',
        issueId: 'issue-1',
        agent: 'pi',
      },
    })

    await expect(run(inboxPushFactory.build(ctx), {
      comments: 'done',
      docs: [{ path: 'research/a.md' }],
    })).resolves.toMatchObject({ ok: true, entryId: 'entry-1' })

    const origin = {
      kind: 'session',
      workspaceId: 'ws-1',
      resumeId: 'resume-1',
      agent: 'pi',
      execution: { kind: 'headless', taskId: 'task-1' },
    }
    expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({
      artifact: { kind: 'inbox', inboxEntryId: 'entry-1' },
      action: 'sent',
      origin,
    }))
    expect(append).toHaveBeenNthCalledWith(2, expect.objectContaining({
      artifact: { kind: 'report', workspaceId: 'ws-1', path: 'research/a.md' },
      action: 'sent',
      origin,
    }))
  })

  it('records an honest unknown origin when no Session context is available', async () => {
    const append = vi.fn(async (input) => ({ id: 'p-1', ...input }))
    const ctx = context({ provenanceStore: { append, list: vi.fn(), latest: vi.fn() } })
    await run(inboxPushFactory.build(ctx), { comments: 'manual' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      origin: { kind: 'unknown', reason: 'missing-session-origin' },
    }))
  })
})
