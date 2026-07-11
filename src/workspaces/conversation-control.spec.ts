import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CliAdapter } from './cli-adapter.js'
import { createWorkspaceConversationControl } from './conversation-control.js'
import { headlessLogPaths, type HeadlessTaskRecord } from './headless-task-registry.js'
import type { WorkspaceService } from './service.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function fakeAdapter(id = 'pi'): CliAdapter {
  return {
    id,
    kind: 'agent',
    capabilities: { headless: true },
    composeHeadlessCommand: () => [id],
    bootstrap: vi.fn(async () => undefined),
  } as unknown as CliAdapter
}

function fakeService(opts: {
  identity?: { resumeId: string; wsId: string; agent: string } | null
  task?: HeadlessTaskRecord | null
  logsDir?: string
} = {}) {
  const adapter = fakeAdapter()
  const workspace = {
    id: 'ws-peer',
    tag: 'peer-desk',
    dir: '/tmp/peer-desk',
    createdAt: '2026-07-11T00:00:00.000Z',
    agents: ['pi'],
  }
  const dispatchHeadlessTask = vi.fn(async () => ({
    taskId: 'task-follow-up',
    resumeId: opts.identity?.resumeId ?? 'resume-fresh',
  }))
  const svc = {
    config: { launcherRepoRoot: '/repo' },
    registry: { get: (id: string) => id === workspace.id ? workspace : undefined },
    adapters: { get: (id: string) => id === adapter.id ? adapter : undefined },
    resumeRegistry: { get: () => opts.identity ?? null },
    resolveDefaultAgentId: vi.fn(async () => 'pi'),
    dispatchHeadlessTask,
    headlessTasks: { get: () => opts.task ?? null },
    headlessLogsDir: opts.logsDir ?? '/tmp/logs',
  } as unknown as WorkspaceService
  return { svc, adapter, workspace, dispatchHeadlessTask }
}

describe('Workspace conversation control', () => {
  it('continues the exact runtime conversation behind a resumeId', async () => {
    const identity = { resumeId: 'resume-peer', wsId: 'ws-peer', agent: 'pi' }
    const { svc, adapter, workspace, dispatchHeadlessTask } = fakeService({ identity })
    const control = createWorkspaceConversationControl(svc)

    await expect(control.ask({
      resumeId: identity.resumeId,
      prompt: 'Why did you make this call?',
      timeoutMs: 300_000,
    })).resolves.toEqual({
      taskId: 'task-follow-up',
      resumeId: identity.resumeId,
      workspaceId: workspace.id,
      workspace: workspace.tag,
      agent: 'pi',
      continued: true,
    })
    expect(dispatchHeadlessTask).toHaveBeenCalledWith(
      workspace,
      adapter,
      'Why did you make this call?',
      300_000,
      undefined,
      identity.resumeId,
    )
  })

  it('starts a fresh worker at the target workspace when no origin exists', async () => {
    const { svc, adapter, workspace, dispatchHeadlessTask } = fakeService()
    const control = createWorkspaceConversationControl(svc)

    await expect(control.ask({
      workspaceId: workspace.id,
      prompt: 'Reconstruct the rationale from this workspace.',
      timeoutMs: 300_000,
    })).resolves.toMatchObject({
      resumeId: 'resume-fresh',
      workspace: workspace.tag,
      agent: 'pi',
      continued: false,
    })
    expect(dispatchHeadlessTask).toHaveBeenCalledWith(
      workspace,
      adapter,
      'Reconstruct the rationale from this workspace.',
      300_000,
      undefined,
      undefined,
    )
  })

  it('reads normalized output without exposing the native agent session id', async () => {
    const logsDir = await mkdtemp(join(tmpdir(), 'conversation-control-'))
    dirs.push(logsDir)
    const task: HeadlessTaskRecord = {
      taskId: 'task-1',
      resumeId: 'resume-1',
      parentTaskId: 'task-0',
      wsId: 'ws-peer',
      agent: 'pi',
      prompt: 'why?',
      status: 'done',
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      agentSessionId: 'native-secret',
    }
    const structured = {
      schemaVersion: 1 as const,
      assistantText: 'Because the breadth rule passed.',
      blocks: [{ type: 'text' as const, text: 'Because the breadth rule passed.' }],
      metrics: { textBlocks: 1, toolCalls: 0, toolFailures: 0 },
      truncated: false,
    }
    await writeFile(headlessLogPaths(logsDir, task.taskId).structured, JSON.stringify(structured))
    const { svc } = fakeService({ task, logsDir })

    const result = await createWorkspaceConversationControl(svc).read(task.taskId)
    expect(result).toMatchObject({
      taskId: task.taskId,
      resumeId: task.resumeId,
      parentTaskId: task.parentTaskId,
      status: 'done',
      structured,
    })
    expect(result).not.toHaveProperty('agentSessionId')
  })
})
