import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectorClient } from '@traderalice/connector-protocol'

import type { HeadlessTurnProgress } from '../headless-progress.js'
import { createTelegramConnectorDesk } from './telegram-connector.js'
import {
  alreadyProjectedDeskText,
  deskProgressMessageId,
  deskProgressScope,
  projectDeskComment,
  projectDeskLifecycle,
  projectDeskTurnProgress,
  projectWorkspaceDeskTurnProgress,
  resetProjectedDeskTexts,
  sealedProgressTexts,
  shouldProjectDeskComment,
} from './telegram-desk-project.js'

let home: string
let wsDir: string

beforeEach(async () => {
  resetProjectedDeskTexts()
  home = await mkdtemp(join(tmpdir(), 'tg-desk-progress-'))
  wsDir = join(home, 'ws')
  await mkdir(join(wsDir, '.alice', 'issues'), { recursive: true })
})

afterEach(async () => {
  resetProjectedDeskTexts()
  await rm(home, { recursive: true, force: true })
})

function progress(blocks: HeadlessTurnProgress['blocks']): HeadlessTurnProgress {
  return {
    updatedAt: 1,
    assistantText: [...blocks].reverse().find((block) => block.type === 'text')?.text ?? null,
    blocks,
    metrics: {
      textBlocks: blocks.filter((block) => block.type === 'text').length,
      toolCalls: blocks.filter((block) => block.type === 'tool').length,
      toolFailures: 0,
    },
  }
}

function mockClient() {
  const sent: Array<{ id: string; conversationId: string; phase: string; text?: string }> = []
  const client = {
    sendOwnerMessage: async (message: { id: string; conversationId: string; phase: string; text?: string }) => {
      sent.push(message)
      return { accepted: true }
    },
  } as unknown as ConnectorClient
  return { client, sent }
}

describe('sealedProgressTexts', () => {
  it('sends only the last consecutive text before a tool or error', () => {
    expect(sealedProgressTexts(progress([
      { type: 'text', text: "I'll" },
      { type: 'text', text: "I'll check the book." },
      { type: 'tool', id: 't1', name: 'Read', status: 'running' },
      { type: 'text', text: 'The overnight risk is low.' },
    ]))).toEqual(["I'll check the book."])
  })

  it('ships each sealed narration and keeps the trailing reply local', () => {
    expect(sealedProgressTexts(progress([
      { type: 'text', text: 'Looking at the book.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'completed' },
      { type: 'text', text: 'Checking another file.' },
      { type: 'tool', id: 't2', name: 'Read', status: 'running' },
      { type: 'text', text: 'Here is the answer.' },
    ]))).toEqual(['Looking at the book.', 'Checking another file.'])
  })

  it('does not ship a lone trailing text, tools, or errors', () => {
    expect(sealedProgressTexts(progress([
      { type: 'text', text: 'Final answer only.' },
    ]))).toEqual([])
    expect(sealedProgressTexts(progress([
      { type: 'tool', id: 't1', name: 'Read', status: 'running' },
      { type: 'text', text: 'After the tool.' },
    ]))).toEqual([])
    expect(sealedProgressTexts(progress([
      { type: 'error', message: 'boom' },
    ]))).toEqual([])
  })

  it('consumes [[no-reply]] only for connector cron Issue progress', () => {
    const snapshot = progress([
      { type: 'text', text: 'We discussed [[no-reply]] syntax.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'running' },
    ])
    expect(sealedProgressTexts(snapshot)).toEqual(['We discussed [[no-reply]] syntax.'])
    expect(sealedProgressTexts(snapshot, {
      kind: 'connector-cron-issue',
      connectorId: 'telegram',
    })).toEqual([])
  })
})

describe('deskProgressScope', () => {
  it('prefers the comment id for an Issue reply and the task id for a fire', () => {
    expect(deskProgressScope({
      taskId: 'run-reply',
      inquiry: {
        subject: {
          kind: 'issue',
          workspaceId: 'ws-a',
          issueId: 'telegram-phone-desk',
          relation: 'owner',
          commentId: 'telegram-1',
        },
      },
    })).toEqual({
      workspaceId: 'ws-a',
      issueId: 'telegram-phone-desk',
      scopeId: 'telegram-1',
    })
    expect(deskProgressScope({
      taskId: 'run-fire',
      trigger: { kind: 'issue', workspaceId: 'ws-a', issueId: 'telegram-phone-desk' },
    })).toEqual({
      workspaceId: 'ws-a',
      issueId: 'telegram-phone-desk',
      scopeId: 'run-fire',
    })
    expect(deskProgressScope({
      taskId: 'run-inbox',
      inquiry: {
        subject: { kind: 'inbox', entryId: 'in-1' },
      },
    })).toBeNull()
  })
})

describe('projectDeskTurnProgress', () => {
  const desk = { connectorDesk: 'telegram', status: 'todo' as const }

  it('sends sealed texts once and skips tools', async () => {
    const { client, sent } = mockClient()
    const snapshot = progress([
      { type: 'text', text: 'Looking at the book.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'running' },
      { type: 'text', text: 'Still thinking.' },
    ])
    await projectDeskTurnProgress({
      issue: desk,
      scopeId: 'telegram-1',
      progress: snapshot,
      client,
    })
    await projectDeskTurnProgress({
      issue: desk,
      scopeId: 'telegram-1',
      progress: snapshot,
      client,
    })
    expect(sent).toEqual([expect.objectContaining({
      id: deskProgressMessageId('telegram-1', 'Looking at the book.'),
      conversationId: 'telegram-1',
      phase: 'progress',
      text: 'Looking at the book.',
    })])
    expect(alreadyProjectedDeskText('telegram-1', 'Looking at the book.')).toBe(true)
  })

  it('does not project ordinary Issues or a canceled desk', async () => {
    const { client, sent } = mockClient()
    const snapshot = progress([
      { type: 'text', text: 'Looking.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'running' },
    ])
    await projectDeskTurnProgress({
      issue: { status: 'todo' },
      scopeId: 'c1',
      progress: snapshot,
      client,
    })
    await projectDeskTurnProgress({
      issue: { connectorDesk: 'telegram', status: 'canceled' },
      scopeId: 'c1',
      progress: snapshot,
      client,
    })
    expect(sent).toEqual([])
  })

  it('loads the live desk Issue from the Workspace', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsDir },
      [{ id: 'ws-a', dir: wsDir }],
    )
    expect(created.ok).toBe(true)
    const { client, sent } = mockClient()
    await projectWorkspaceDeskTurnProgress({
      wsDir,
      issueId: created.ok ? created.issue.id : 'telegram-phone-desk',
      scopeId: 'run-1',
      progress: progress([
        { type: 'text', text: 'Heartbeat check.' },
        { type: 'error', message: 'later' },
      ]),
      client,
    })
    expect(sent.map((item) => item.text)).toEqual(['Heartbeat check.'])
  })
})

describe('owner-chat lifecycle', () => {
  it('projects accepted without fake text and failed as a visible terminal event', async () => {
    const { client, sent } = mockClient()
    const issue = { connectorDesk: 'telegram', status: 'todo' as const }
    await projectDeskLifecycle({ issue, conversationId: 'comment-1', phase: 'accepted', client })
    await projectDeskLifecycle({
      issue,
      conversationId: 'comment-1',
      phase: 'failed',
      text: 'The Agent could not start.',
      client,
    })
    expect(sent[0]).toMatchObject({ conversationId: 'comment-1', phase: 'accepted' })
    expect(sent[0]).not.toHaveProperty('text')
    expect(sent[1]).toMatchObject({
      conversationId: 'comment-1', phase: 'failed', text: 'The Agent could not start.',
    })
  })
})

describe('final comment projection', () => {
  it('treats [[no-reply]] as control syntax only with connector cron metadata', async () => {
    const { client, sent } = mockClient()
    const issue = { connectorDesk: 'telegram' }
    const comment = {
      id: 'comment-reply-run-quoted',
      author: '@resume-a',
      at: 'now',
      markdown: 'Here is how `[[no-reply]]` works.',
    }
    expect(shouldProjectDeskComment(issue, comment)).toBe(true)
    await projectDeskComment(issue, comment, client)
    expect(sent.map((item) => item.text)).toEqual(['Here is how `[[no-reply]]` works.'])

    expect(shouldProjectDeskComment(issue, comment, {
      triggerMetadata: {
        kind: 'connector-cron-issue',
        connectorId: 'telegram',
      },
    })).toBe(false)
  })

  it('persists a final comment even when the same text was shown in an ephemeral draft', async () => {
    const { client, sent } = mockClient()
    const issue = { connectorDesk: 'telegram' }
    await projectDeskTurnProgress({
      issue: { ...issue, status: 'todo' },
      scopeId: 'telegram-1',
      progress: progress([
        { type: 'text', text: 'Looking at the book.' },
        { type: 'tool', id: 't1', name: 'Read', status: 'completed' },
        { type: 'text', text: 'Looking at the book.' },
      ]),
      client,
    })
    const comment = {
      id: 'comment-reply-run-1',
      author: '@resume-a',
      at: 'now',
      markdown: 'Looking at the book.',
      replyTo: 'telegram-1',
    }
    expect(shouldProjectDeskComment(issue, comment)).toBe(true)
    await projectDeskComment(issue, comment, client)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      conversationId: 'telegram-1',
      phase: 'final',
      text: 'Looking at the book.',
    })
    expect(alreadyProjectedDeskText('telegram-1', 'Looking at the book.')).toBe(false)
  })

  it('still ships a different final reply', async () => {
    const { client, sent } = mockClient()
    const issue = { connectorDesk: 'telegram' }
    await projectDeskTurnProgress({
      issue: { ...issue, status: 'todo' },
      scopeId: 'run-1',
      progress: progress([
        { type: 'text', text: 'Looking at the book.' },
        { type: 'tool', id: 't1', name: 'Read', status: 'completed' },
        { type: 'text', text: 'Here is the answer.' },
      ]),
      client,
    })
    await projectDeskComment(issue, {
      id: 'comment-fire-run-1',
      author: '@resume-a',
      at: 'now',
      markdown: 'Here is the answer.',
    }, client, { progressScopeId: 'run-1' })
    expect(sent.map((item) => item.text)).toEqual([
      'Looking at the book.',
      'Here is the answer.',
    ])
  })
})
