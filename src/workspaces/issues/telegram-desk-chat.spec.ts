import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectorClient } from '@traderalice/connector-protocol'

import { createTelegramConnectorDesk } from './telegram-connector.js'
import {
  containsTelegramNoReply,
  ingestTelegramOwnerMessage,
  pullTelegramDeskInbound,
  shouldProjectDeskComment,
  stampTelegramDeskScheduledFire,
  type TelegramDeskChatHost,
} from './telegram-desk-chat.js'

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

function host(): TelegramDeskChatHost {
  return {
    listWorkspaces: () => [{ id: 'ws-a', dir: wsDir }],
    getWorkspace: (id) => id === 'ws-a' ? { id: 'ws-a', dir: wsDir } : undefined,
    provenanceStore: () => ({
      append: async () => undefined,
      list: () => [],
      latest: () => undefined,
    } as unknown as NonNullable<ReturnType<TelegramDeskChatHost['provenanceStore']>>),
    conversation: () => undefined,
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
})
