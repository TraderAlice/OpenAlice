import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectorClient } from '@traderalice/connector-protocol'

import type { HeadlessTurnProgress } from '../headless-progress.js'
import { createTelegramConnectorDesk } from './telegram-connector.js'
import {
  deskProgressMessageId,
  deskProgressScope,
  projectDeskComment,
  projectDeskLifecycle,
  sealedProgressTexts,
  shouldProjectDeskComment,
} from './telegram-desk-project.js'

let home: string
let wsDir: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tg-desk-progress-'))
  wsDir = join(home, 'ws')
  await mkdir(join(wsDir, '.alice', 'issues'), { recursive: true })
})

afterEach(async () => {
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

  it('preserves syntax for Connector to interpret', () => {
    const snapshot = progress([
      { type: 'text', text: 'We discussed [[no-reply]] syntax.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'running' },
    ])
    expect(sealedProgressTexts(snapshot)).toEqual(['We discussed [[no-reply]] syntax.'])
    expect(sealedProgressTexts(snapshot, {
      kind: 'connector-cron-issue',
      connectorId: 'telegram',
    })).toEqual(['We discussed [[no-reply]] syntax.'])
  })
})

describe('deskProgressScope', () => {
  it('does not publish an internal ask merely because its subject is a desk Issue', () => {
    expect(deskProgressScope({ taskId: 'internal-ask', inquiry: {
      subject: { kind: 'issue', workspaceId: 'ws-a', issueId: 'telegram-phone-desk', relation: 'run', runId: 'previous-run' },
    } })).toBeNull()
  })

  it('requires an explicit delivery and uses the task identity rather than the comment id', () => {
    const task = { taskId: 'run-reply', communication: {
      version: 1 as const, origin: { kind: 'human' as const },
      target: { workspaceId: 'execution', resumeId: 'r', agent: 'codex' },
      reply: { kind: 'issue-comment' as const, workspaceId: 'ws-a', issueId: 'desk', commentId: 'c1' },
      delivery: { connectorId: 'telegram', source: 'conversation' as const, contentWorkspaceId: 'execution' },
    } }
    expect(deskProgressScope(task)).toEqual({ workspaceId: 'ws-a', issueId: 'desk', scopeId: 'run-reply' })
    expect(deskProgressScope({ ...task, communication: undefined })).toBeNull()
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
  it('forwards no-reply syntax unchanged for Connector interpretation', async () => {
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
    })).toBe(true)
  })

  it('forwards in-turn comments with their automation source and progress phase', async () => {
    const { client, sent } = mockClient()
    const issue = { connectorDesk: 'telegram' }
    const comment = { id: 'note', author: '@agent', at: 'now', markdown: 'Still checking.' }
    await projectDeskComment(issue, comment, client, { phase: 'progress', progressScopeId: 'run' })
    expect(sent[0]).toMatchObject({ phase: 'progress', conversationId: 'run', text: 'Still checking.' })
    await projectDeskComment(issue, { ...comment, markdown: '[[no-reply]] quiet' }, client, {
      phase: 'progress', progressScopeId: 'run', automated: true,
    })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({ source: 'automation', text: '[[no-reply]] quiet', phase: 'progress' })
  })

})
