import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
  })
})
