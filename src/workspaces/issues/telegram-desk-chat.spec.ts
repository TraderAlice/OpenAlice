import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorClient } from '@traderalice/connector-protocol'

import { readWorkspaceIssues } from './declaration.js'
import { createTelegramConnectorDesk } from './telegram-connector.js'
import {
  containsTelegramNoReply,
  formatTelegramInboundStack,
  ingestTelegramOwnerMessage,
  ingestTelegramOwnerMessages,
  pullTelegramDeskInbound,
  startTelegramDeskInboundPoll,
  shouldProjectDeskComment,
  stampTelegramDeskScheduledFire,
  telegramDeskHasRunningWork,
  type TelegramDeskChatHost,
} from './telegram-desk-chat.js'
import { readIssueComments } from './comments.js'

let home: string
let wsDir: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tg-desk-chat-'))
  wsDir = join(home, 'ws')
  await mkdir(join(wsDir, '.alice', 'issues'), { recursive: true })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

function host(overrides: Partial<TelegramDeskChatHost> = {}): TelegramDeskChatHost {
  return {
    listWorkspaces: () => [{ id: 'ws-a', dir: wsDir }],
    getWorkspace: (id) => id === 'ws-a' ? { id: 'ws-a', dir: wsDir } : undefined,
    provenanceStore: () => ({
      append: async () => undefined,
      list: () => [],
      latest: () => undefined,
    } as unknown as NonNullable<ReturnType<TelegramDeskChatHost['provenanceStore']>>),
    conversation: () => undefined,
    ...overrides,
  }
}

describe('telegram desk chat filter', () => {
  it('projects agent comments and skips inbound telegram or [[no-reply]]', () => {
    const issue = { telegramConnector: true as const }
    expect(shouldProjectDeskComment(issue, {
      id: 'c1', author: '@resume-a', at: 'now', markdown: 'Hello from the desk.',
    })).toBe(true)
    expect(shouldProjectDeskComment(issue, {
      id: 'c2', author: 'human', at: 'now', markdown: 'From Telegram', via: 'telegram',
    })).toBe(false)
    expect(shouldProjectDeskComment(issue, {
      id: 'c3', author: '@resume-a', at: 'now', markdown: '[[no-reply]] nothing to say',
    })).toBe(false)
    expect(shouldProjectDeskComment({}, {
      id: 'c4', author: '@resume-a', at: 'now', markdown: 'ordinary issue',
    })).toBe(false)
  })

  it('matches the no-reply tag as a literal substring', () => {
    expect(containsTelegramNoReply('[[no-reply]] quiet')).toBe(true)
    expect(containsTelegramNoReply('no reply')).toBe(false)
  })
})

describe('telegram desk ingest and stamp', () => {
  it('refuses inbound when the phone desk is disabled', async () => {
    const result = await ingestTelegramOwnerMessage(host(), {
      connectorId: 'telegram',
      userId: '42',
      text: 'Anybody home?',
    })
    expect(result).toEqual({ ok: false, reason: 'desk_disabled' })
  })

  it('recruits and claims a first Session for an inbound DM on @new-then-resume', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'run-desk-owner',
      resumeId: 'resume-desk-owner',
      workspaceId: 'ws-a',
      workspace: 'ws-a',
      agent: 'pi',
      resolution: {
        mode: 'reconstructed' as const,
        workspaceId: 'ws-a',
        reason: 'explicit-workspace' as const,
      },
    }))
    const append = vi.fn(async (input: unknown) => ({ id: 'p-1', ...(input as object) }))
    const result = await ingestTelegramOwnerMessage(host({
      provenanceStore: () => ({
        append,
        list: () => [],
        latest: () => undefined,
      } as unknown as NonNullable<ReturnType<TelegramDeskChatHost['provenanceStore']>>),
      conversation: () => ({ ask, read: vi.fn() } as unknown as NonNullable<ReturnType<TelegramDeskChatHost['conversation']>>),
    }), {
      connectorId: 'telegram',
      userId: '42',
      text: 'Switch to a new coworker.',
    })
    expect(result.ok).toBe(true)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'workspace', workspaceId: 'ws-a' },
      subject: expect.objectContaining({ relation: 'owner' }),
    }))
    const live = await readWorkspaceIssues(wsDir)
    expect(live.ok && live.issues[0]?.assignee).toBe('@resume-desk-owner')
  })

  it('records an inbound owner DM as a human comment that does not echo', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    const result = await ingestTelegramOwnerMessage(host(), {
      connectorId: 'telegram',
      userId: '42',
      text: 'What is the overnight risk?',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.comment.author).toBe('human')
    expect(result.comment.via).toBe('telegram')
    expect(result.comment.markdown).toBe('What is the overnight risk?')
    expect(shouldProjectDeskComment(created.ok ? created.issue : { telegramConnector: true }, result.comment)).toBe(false)
  })

  it('stamps a scheduled fire as a comment', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const comment = await stampTelegramDeskScheduledFire({
      host: host(),
      workspaceId: 'ws-a',
      issueId: created.issue.id,
      task: {
        taskId: 'run-1',
        resumeId: 'resume-desk-owner',
        wsId: 'ws-a',
        agent: 'pi',
        prompt: 'wake',
        startedAt: 1,
        status: 'done',
        finishedAt: 2,
      },
      assistantText: 'Markets are quiet. [[no-reply]] no send.',
    })
    expect(comment?.markdown).toContain('[[no-reply]]')
    expect(comment?.id).toBe('comment-fire-run-1')
    if (!comment) return
    expect(shouldProjectDeskComment(created.issue, comment)).toBe(false)
  })

  it('does not publish partial assistant text from a failed scheduled fire', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const comment = await stampTelegramDeskScheduledFire({
      host: host(),
      workspaceId: 'ws-a',
      issueId: created.issue.id,
      task: {
        taskId: 'run-failed',
        resumeId: 'resume-desk-owner',
        wsId: 'ws-a',
        agent: 'pi',
        prompt: 'wake',
        startedAt: 1,
        status: 'failed',
        finishedAt: 2,
      },
      assistantText: 'Partial answer before the runtime failed.',
    })

    expect(comment).toBeNull()
  })

  it('quotes stacked inbound DMs as one comment', () => {
    expect(formatTelegramInboundStack(['one'])).toBe('one')
    expect(formatTelegramInboundStack([
      '那个事情我想了想你再改改',
      '算了不用改了,就这样吧',
    ])).toBe([
      '> 那个事情我想了想你再改改',
      '> 算了不用改了,就这样吧',
    ].join('\n'))
    expect(telegramDeskHasRunningWork([
      {
        status: 'running',
        inquiry: {
          subject: { kind: 'issue', workspaceId: 'ws-a', issueId: 'telegram-phone-desk', relation: 'owner' },
          question: 'hi',
          resolution: { mode: 'exact' },
        },
      },
    ], { wsId: 'ws-a', issue: { id: 'telegram-phone-desk' } })).toBe(true)
    expect(telegramDeskHasRunningWork([
      { status: 'done', trigger: { kind: 'issue', workspaceId: 'ws-a', issueId: 'telegram-phone-desk' } },
    ], { wsId: 'ws-a', issue: { id: 'telegram-phone-desk' } })).toBe(false)
  })

  it('records stacked inbound DMs as one human comment', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    const result = await ingestTelegramOwnerMessages(host(), [
      { connectorId: 'telegram', userId: '42', text: '那个事情我想了想你再改改' },
      { connectorId: 'telegram', userId: '42', text: '算了不用改了,就这样吧' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.comment.markdown).toBe([
      '> 那个事情我想了想你再改改',
      '> 算了不用改了,就这样吧',
    ].join('\n'))
    const comments = await readIssueComments(wsDir, created.ok ? created.issue.id : 'telegram-phone-desk')
    expect(comments.ok && comments.comments).toHaveLength(1)
  })

  it('does not drain Connector inbound until a live desk exists', async () => {
    let drained = 0
    const client = {
      drainInbound: async () => {
        drained += 1
        return [{ connectorId: 'telegram', userId: '42', text: 'queued' }]
      },
    } as unknown as ConnectorClient

    await pullTelegramDeskInbound(host(), client)
    expect(drained).toBe(0)

    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    await pullTelegramDeskInbound(host(), client)
    expect(drained).toBe(1)
  })

  it('leaves Connector inbound stacked while the desk is generating', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    let drained = 0
    const client = {
      drainInbound: async () => {
        drained += 1
        return [{ connectorId: 'telegram', userId: '42', text: 'later' }]
      },
    } as unknown as ConnectorClient

    await pullTelegramDeskInbound(host({ deskGenerating: () => true }), client)
    expect(drained).toBe(0)

    await pullTelegramDeskInbound(host({ deskGenerating: () => false }), client)
    expect(drained).toBe(1)
  })

  it('does not overlap inbound drains when one poll is still running', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)

    let active = 0
    let maxActive = 0
    let drains = 0
    const client = {
      drainInbound: async () => {
        drains += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active -= 1
        return []
      },
    } as unknown as ConnectorClient

    const stop = startTelegramDeskInboundPoll(host(), { intervalMs: 2, client })
    await new Promise((resolve) => setTimeout(resolve, 55))
    stop()

    expect(drains).toBeGreaterThan(1)
    expect(maxActive).toBe(1)
  })
})
