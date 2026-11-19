import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HeadlessTaskRegistry, headlessLogPaths } from '../workspaces/headless-task-registry.js'
import type { Logger } from '../workspaces/logger.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { makeSessionControl } from './cli.js'

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

describe('makeSessionControl.show', () => {
  let root: string
  let logsDir: string
  let registry: HeadlessTaskRegistry

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oa-session-control-'))
    logsDir = join(root, 'logs')
    await mkdir(logsDir, { recursive: true })
    registry = await HeadlessTaskRegistry.load(join(root, 'tasks.json'), noopLogger)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function fakeService(opts: {
    resumeId?: string
    blocks?: unknown[]
  } = {}): WorkspaceService {
    const resumeId = opts.resumeId ?? 'resume-target'
    return {
      headlessLogsDir: logsDir,
      headlessTasks: registry,
      resumeRegistry: {
        get: (id: string) => id === resumeId
          ? { resumeId, wsId: 'ws-1', agent: 'codex', createdAt: 1, updatedAt: 2, lifecycle: 'active' }
          : undefined,
      },
      sessionDirectory: async () => ({
        workspace: { id: 'ws-1', tag: 'desk' },
        sessions: [{ resumeId, agent: 'codex', createdAt: 1, updatedAt: 2, lifecycle: 'active', resumable: true, active: false }],
      }),
      sessionRegistry: {
        findByResumeId: () => undefined,
      },
      pool: {
        get: () => undefined,
      },
      sessionMailbox: {
        unreadFor: () => [],
        hasActiveWatermark: () => false,
      },
      executions: {
        current: () => null,
        stop: async () => false,
        admission: {
          blocks: () => opts.blocks ?? [],
        },
      },
    } as unknown as WorkspaceService
  }

  it('omits lastError and admissionBlocks when the latest execution is healthy', async () => {
    const task = await registry.create({
      wsId: 'ws-1',
      resumeId: 'resume-target',
      agent: 'codex',
      prompt: 'hello',
      startedAt: 100,
    })
    await registry.complete(task.taskId, {
      status: 'done',
      finishedAt: 200,
      exitCode: 0,
      output: { hasAssistantReply: true, assistantPreview: 'all good', blockCount: 1, toolCalls: 1, toolFailures: 0 },
    })

    const detail = await makeSessionControl(fakeService()).show('resume-target')
    expect(detail).not.toBeNull()
    expect(detail).not.toHaveProperty('lastError')
    expect(detail).not.toHaveProperty('admissionBlocks')
    expect((detail!['recentExecutions'] as Array<{ taskId: string }>).map((r) => r.taskId)).toEqual([task.taskId])
  })

  it('exposes top-level lastError from failed execution metadata and admissionBlocks when blocked', async () => {
    const task = await registry.create({
      wsId: 'ws-1',
      resumeId: 'resume-target',
      agent: 'codex',
      prompt: 'run',
      startedAt: 100,
    })
    await registry.complete(task.taskId, {
      status: 'failed',
      finishedAt: 250,
      processStarted: false,
      launchErrorCode: 'executable_not_found',
      exitCode: -1,
      signal: null,
      killed: false,
      error: 'codex binary not found',
      output: { hasAssistantReply: false, assistantPreview: 'starting...', blockCount: 1, toolCalls: 1, toolFailures: 1 },
    })

    const block = { id: 'blk-1', resumeId: 'resume-target', kind: 'execution-fault', reason: 'Three consecutive failures' }
    const detail = await makeSessionControl(fakeService({ blocks: [block] })).show('resume-target')
    expect(detail).toMatchObject({
      lastError: {
        taskId: task.taskId,
        status: 'failed',
        message: 'codex binary not found',
        at: 250,
        exitCode: -1,
        signal: null,
        killed: false,
        launchErrorCode: 'executable_not_found',
        toolFailures: 1,
        assistantPreview: 'starting...',
      },
      admissionBlocks: [block],
    })
  })

  it('reads structured log or stderr tail when latest.error is absent on a failed run', async () => {
    const structuredTask = await registry.create({
      wsId: 'ws-1',
      resumeId: 'resume-target',
      agent: 'codex',
      prompt: 'run 1',
      startedAt: 100,
    })
    await registry.complete(structuredTask.taskId, { status: 'failed', finishedAt: 150, exitCode: 1 })
    const paths1 = headlessLogPaths(logsDir, structuredTask.taskId)
    await writeFile(paths1.structured, JSON.stringify({
      schemaVersion: 1,
      blocks: [{ type: 'error', message: '401 Unauthorized from upstream' }],
    }), 'utf8')

    const fromStructured = await makeSessionControl(fakeService()).show('resume-target')
    expect(fromStructured?.['lastError']).toMatchObject({
      taskId: structuredTask.taskId,
      status: 'failed',
      message: '401 Unauthorized from upstream',
      at: 150,
      exitCode: 1,
    })

    const stderrTask = await registry.create({
      wsId: 'ws-1',
      resumeId: 'resume-target',
      agent: 'codex',
      prompt: 'run 2',
      startedAt: 200,
    })
    await registry.complete(stderrTask.taskId, { status: 'failed', finishedAt: 260, exitCode: 2 })
    const paths2 = headlessLogPaths(logsDir, stderrTask.taskId)
    await writeFile(paths2.stderr, '\x1b[31mFatal stderr crash\x1b[0m\n', 'utf8')

    const fromStderr = await makeSessionControl(fakeService()).show('resume-target')
    expect(fromStderr?.['lastError']).toMatchObject({
      taskId: stderrTask.taskId,
      status: 'failed',
      message: 'Fatal stderr crash',
      at: 260,
      exitCode: 2,
    })
  })

  it('exposes lastError summarizing tool failures when a done run had toolFailures > 0', async () => {
    const task = await registry.create({
      wsId: 'ws-1',
      resumeId: 'resume-target',
      agent: 'codex',
      prompt: 'check',
      startedAt: 100,
    })
    await registry.complete(task.taskId, {
      status: 'done',
      finishedAt: 300,
      exitCode: 0,
      output: { hasAssistantReply: true, assistantPreview: 'partial output', blockCount: 3, toolCalls: 4, toolFailures: 2 },
    })

    const detail = await makeSessionControl(fakeService()).show('resume-target')
    expect(detail?.['lastError']).toMatchObject({
      taskId: task.taskId,
      status: 'done',
      message: expect.stringContaining('2 tool failure(s)'),
      at: 300,
      toolFailures: 2,
      assistantPreview: 'partial output',
    })
  })

  it('keeps a session’s recentExecutions visible even in a busy workspace with >50 other runs', async () => {
    const ownTask = await registry.create({
      wsId: 'ws-1',
      resumeId: 'resume-target',
      agent: 'codex',
      prompt: 'target turn',
      startedAt: 1,
    })
    await registry.complete(ownTask.taskId, { status: 'done', finishedAt: 2 })

    for (let i = 0; i < 60; i++) {
      const noise = await registry.create({
        wsId: 'ws-1',
        resumeId: 'resume-busy-other',
        agent: 'codex',
        prompt: `noise ${i}`,
        startedAt: 10 + i,
      })
      await registry.complete(noise.taskId, { status: 'done', finishedAt: 11 + i })
    }

    const detail = await makeSessionControl(fakeService()).show('resume-target')
    const recent = detail?.['recentExecutions'] as Array<{ taskId: string }>
    expect(recent.map((r) => r.taskId)).toEqual([ownTask.taskId])
  })
})
