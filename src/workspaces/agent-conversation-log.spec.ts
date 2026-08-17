import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AgentConversationLog,
  type AgentConversationLogEvent,
} from './agent-conversation-log.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('AgentConversationLog', () => {
  it('appends safe dispatch and completion events in order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-conversation-log-'))
    dirs.push(dir)
    const path = join(dir, 'state', 'agent-conversations.jsonl')
    const logger = { warn: vi.fn() }
    const log = new AgentConversationLog(path, logger)

    await Promise.all([
      log.recordDispatch({
        taskId: 'run-1',
        resumeId: 'resume-peer',
        workspaceId: 'ws-peer',
        agent: 'pi',
        startedAt: 10,
        conversation: {
          source: {
            kind: 'session',
            workspaceId: 'ws-chat',
            resumeId: 'resume-chat',
            agent: 'codex',
            execution: { kind: 'interactive', sessionRecordId: 'session-chat' },
          },
          requestedTarget: { kind: 'workspace', workspaceId: 'ws-peer' },
          originalPrompt: 'Research this.',
          deliveredPrompt: 'Research this.',
          promptMode: 'plain',
          resolution: {
            mode: 'reconstructed',
            workspaceId: 'ws-peer',
            reason: 'explicit-workspace',
          },
        },
      }),
      log.recordCompletion({
        taskId: 'run-1',
        status: 'done',
        finishedAt: 20,
        assistantText: 'Accepted.',
        durationMs: 10,
      }),
    ])

    const events = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentConversationLogEvent)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'conversation.dispatched',
      taskId: 'run-1',
      source: { workspaceId: 'ws-chat', resumeId: 'resume-chat' },
      target: { workspaceId: 'ws-peer', resumeId: 'resume-peer' },
      prompt: { original: 'Research this.', delivered: 'Research this.', mode: 'plain' },
    })
    expect(events[1]).toMatchObject({
      type: 'conversation.completed',
      taskId: 'run-1',
      status: 'done',
      assistantText: 'Accepted.',
    })
    expect(events.some((event) => JSON.stringify(event).includes('native'))).toBe(false)
    expect(logger.warn).not.toHaveBeenCalled()
    await expect(log.query()).resolves.toMatchObject({
      entries: [{
        source: {
          kind: 'session',
          workspaceId: 'ws-chat',
          resumeId: 'resume-chat',
          agent: 'codex',
        },
      }],
    })
    expect((await log.query()).entries[0]?.source).not.toHaveProperty('execution')

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
  })

  it('joins dispatch and completion events into newest-first pages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-conversation-query-'))
    dirs.push(dir)
    const path = join(dir, 'state', 'agent-conversations.jsonl')
    const log = new AgentConversationLog(path, { warn: vi.fn() })

    for (const [taskId, startedAt] of [['run-1', 10], ['run-2', 20]] as const) {
      await log.recordDispatch({
        taskId,
        resumeId: `resume-${taskId}`,
        workspaceId: 'ws-quant',
        agent: 'codex',
        startedAt,
        conversation: {
          source: { kind: 'workspace', workspaceId: 'ws-chat' },
          requestedTarget: taskId === 'run-2'
            ? { kind: 'harness', harness: 'autoquant' }
            : { kind: 'workspace', workspaceId: 'ws-quant' },
          originalPrompt: `Prompt ${taskId}`,
          deliveredPrompt: `Prompt ${taskId}`,
          promptMode: 'plain',
          resolution: { mode: 'reconstructed', workspaceId: 'ws-quant', reason: 'explicit-workspace' },
        },
      })
    }
    await log.recordCompletion({
      taskId: 'run-1',
      status: 'done',
      finishedAt: 30,
      assistantText: 'Finished.',
      durationMs: 20,
    })
    await appendFile(path, '{"type":"conversation.dispatched","partial":', 'utf8')

    await expect(log.query({ page: 1, pageSize: 1 })).resolves.toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      totalPages: 2,
      entries: [{
        taskId: 'run-2',
        status: 'running',
        assistantText: null,
        requestedTarget: { kind: 'harness', harness: 'autoquant' },
      }],
    })
    await expect(log.query({ page: 2, pageSize: 1 })).resolves.toMatchObject({
      entries: [{
        taskId: 'run-1',
        status: 'done',
        assistantText: 'Finished.',
        completedAt: 30,
      }],
    })
  })

  it('returns an empty first page before the migration or first dispatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-conversation-empty-'))
    dirs.push(dir)
    const log = new AgentConversationLog(join(dir, 'missing', 'log.jsonl'), { warn: vi.fn() })

    await expect(log.query()).resolves.toEqual({
      entries: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    await log.recordDispatch({
      taskId: 'run-after-read',
      resumeId: 'resume-after-read',
      workspaceId: 'ws-peer',
      agent: 'pi',
      startedAt: 40,
      conversation: {
        source: { kind: 'human' },
        requestedTarget: { kind: 'workspace', workspaceId: 'ws-peer' },
        originalPrompt: 'Start after the first empty read.',
        deliveredPrompt: 'Start after the first empty read.',
        promptMode: 'plain',
        resolution: { mode: 'reconstructed', workspaceId: 'ws-peer', reason: 'explicit-workspace' },
      },
    })
    await expect(log.query()).resolves.toMatchObject({
      total: 1,
      entries: [{ taskId: 'run-after-read', status: 'running' }],
    })
  })
})
