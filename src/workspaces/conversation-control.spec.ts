import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProvenanceRecord } from '../core/provenance-store.js'
import type { CliAdapter } from './cli-adapter.js'
import {
  createWorkspaceConversationControl,
  resolveWorkspaceConversationTarget,
} from './conversation-control.js'
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
  identity?: { resumeId: string; wsId: string; agent: string; agentSessionId?: string } | null
  provenance?: ProvenanceRecord | null
  reconstruction?: ProvenanceRecord | null
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
  const appendProvenance = vi.fn(async (input) => ({ id: 'p-new', ...input }))
  const svc = {
    config: { launcherRepoRoot: '/repo' },
    registry: { get: (id: string) => id === workspace.id ? workspace : undefined },
    adapters: { get: (id: string) => id === adapter.id ? adapter : undefined },
    resumeRegistry: { get: (id: string) => opts.identity?.resumeId === id ? opts.identity : null },
    provenanceStore: {
      latest: vi.fn((query: { action?: string }) => query.action === 'reconstructed'
        ? opts.reconstruction ?? null
        : opts.provenance ?? null),
      append: appendProvenance,
    },
    resolveDefaultAgentId: vi.fn(async () => 'pi'),
    dispatchHeadlessTask,
    headlessTasks: { get: () => opts.task ?? null },
    headlessLogsDir: opts.logsDir ?? '/tmp/logs',
  } as unknown as WorkspaceService
  return { svc, adapter, workspace, dispatchHeadlessTask, appendProvenance }
}

const origin = {
  kind: 'session' as const,
  workspaceId: 'ws-peer',
  resumeId: 'resume-peer',
  agent: 'pi',
}

function issueProvenance(originValue: ProvenanceRecord['origin'] = origin): ProvenanceRecord {
  return {
    id: 'p-1',
    artifact: { kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit' },
    action: 'created',
    origin: originValue,
    at: 1,
  }
}

describe('Workspace conversation target resolution', () => {
  it('resolves an Issue creator to its exact resumable product Session', () => {
    const identity = { ...origin, wsId: origin.workspaceId, agentSessionId: 'native-private' }
    const { svc } = fakeService({ identity, provenance: issueProvenance() })
    expect(resolveWorkspaceConversationTarget(svc, {
      kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit',
    })).toEqual({
      mode: 'exact',
      origin,
      artifact: { kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit' },
    })
  })

  it('does not replace an attributed but unresumable Session with a fresh worker', () => {
    const identity = { ...origin, wsId: origin.workspaceId }
    const { svc } = fakeService({ identity, provenance: issueProvenance() })
    expect(resolveWorkspaceConversationTarget(svc, {
      kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit',
    })).toMatchObject({
      mode: 'unavailable', reason: 'missing-native-session', attributedOrigin: origin,
    })
  })

  it('reconstructs inside a known Workspace only when no Session origin exists', () => {
    const { svc } = fakeService()
    expect(resolveWorkspaceConversationTarget(svc, {
      kind: 'report', workspaceId: 'ws-peer', path: 'research/report.md',
    })).toMatchObject({
      mode: 'reconstructed', workspaceId: 'ws-peer', reason: 'missing-origin',
    })
  })

  it('treats a human-authored artifact as reconstruction, not exact authorship', () => {
    const { svc } = fakeService({ provenance: issueProvenance({ kind: 'human' }) })
    expect(resolveWorkspaceConversationTarget(svc, {
      kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit',
    })).toMatchObject({
      mode: 'reconstructed', workspaceId: 'ws-peer', reason: 'non-session-origin',
    })
  })

  it('cannot reconstruct a trade decision without an attributed Session or Workspace', () => {
    const { svc } = fakeService()
    expect(resolveWorkspaceConversationTarget(svc, {
      kind: 'trade-decision', accountId: 'alpaca-paper', decisionId: 'commit-1',
    })).toMatchObject({ mode: 'unavailable', reason: 'missing-workspace' })
  })

  it('keeps a previously recruited reconstruction worker without calling it the author', () => {
    const identity = { ...origin, wsId: origin.workspaceId, agentSessionId: 'native-private' }
    const reconstruction = {
      ...issueProvenance(),
      id: 'p-reconstructed',
      action: 'reconstructed' as const,
    }
    const { svc } = fakeService({ identity, reconstruction })
    expect(resolveWorkspaceConversationTarget(svc, {
      kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit',
    })).toMatchObject({
      mode: 'reconstructed', reason: 'prior-reconstruction', origin,
    })
  })
})

describe('Workspace conversation control', () => {
  it('continues the exact Session behind Issue provenance', async () => {
    const identity = { ...origin, wsId: origin.workspaceId, agentSessionId: 'native-private' }
    const { svc, adapter, workspace, dispatchHeadlessTask } = fakeService({
      identity,
      provenance: issueProvenance(),
    })
    const result = await createWorkspaceConversationControl(svc).ask({
      target: { kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit' },
      prompt: 'Why did you create this?',
      timeoutMs: 300_000,
    })

    expect(result).toMatchObject({
      status: 'dispatched', taskId: 'task-follow-up', resumeId: 'resume-peer',
      resolution: { mode: 'exact', origin },
    })
    expect(dispatchHeadlessTask).toHaveBeenCalledWith(
      workspace, adapter, 'Why did you create this?', 300_000, undefined, 'resume-peer',
    )
  })

  it('labels and prompts a fresh reconstruction honestly', async () => {
    const { svc, dispatchHeadlessTask, appendProvenance } = fakeService()
    const result = await createWorkspaceConversationControl(svc).ask({
      target: { kind: 'report', workspaceId: 'ws-peer', path: 'research/report.md' },
      prompt: 'Why did the report reach this conclusion?',
      timeoutMs: 300_000,
    })

    expect(result).toMatchObject({
      status: 'dispatched', resumeId: 'resume-fresh',
      resolution: { mode: 'reconstructed', reason: 'missing-origin' },
    })
    const dispatchedPrompt = (dispatchHeadlessTask.mock.calls as unknown[][])[0]?.[2]
    expect(dispatchedPrompt).toContain('fresh worker reconstructing')
    expect(dispatchedPrompt).toContain('not the original author')
    expect(dispatchedPrompt).toContain('research/report.md')
    expect(appendProvenance).toHaveBeenCalledWith(expect.objectContaining({
      action: 'reconstructed',
      origin: expect.objectContaining({ resumeId: 'resume-fresh' }),
    }))
  })

  it('returns unavailable without dispatching when the attributed Session cannot resume', async () => {
    const identity = { ...origin, wsId: origin.workspaceId }
    const { svc, dispatchHeadlessTask } = fakeService({ identity, provenance: issueProvenance() })
    await expect(createWorkspaceConversationControl(svc).ask({
      target: { kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit' },
      prompt: 'why?', timeoutMs: 300_000,
    })).resolves.toMatchObject({
      status: 'unavailable', resolution: { reason: 'missing-native-session' },
    })
    expect(dispatchHeadlessTask).not.toHaveBeenCalled()
  })

  it('reads normalized output without exposing the native runtime session id', async () => {
    const logsDir = await mkdtemp(join(tmpdir(), 'conversation-control-'))
    dirs.push(logsDir)
    const task: HeadlessTaskRecord = {
      taskId: 'task-1', resumeId: 'resume-1', parentTaskId: 'task-0', wsId: 'ws-peer',
      agent: 'pi', prompt: 'why?', status: 'done', startedAt: 1, finishedAt: 2,
      durationMs: 1, agentSessionId: 'native-secret',
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
    expect(result).toMatchObject({ taskId: 'task-1', resumeId: 'resume-1', structured })
    expect(result).not.toHaveProperty('agentSessionId')
  })
})
