import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HeadlessTaskArgs, HeadlessTaskResult } from './headless-task.js'

const TEST_HEADLESS_BIN = 'openalice-test-headless'

async function completeFakeHeadlessTask(args: HeadlessTaskArgs): Promise<HeadlessTaskResult> {
  const stdout = args.command[0] === TEST_HEADLESS_BIN ? args.command.slice(1).join('\n') : ''
  args.onChildSpawned?.({
    pid: 12345,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  } as never)

  let agentSessionId: string | null = null
  let assistantText: string | null = null
  for (const line of stdout.split('\n').filter((entry) => entry.length > 0)) {
    const sessionId = args.extractSessionId?.(line) ?? null
    if (sessionId && !agentSessionId) {
      agentSessionId = sessionId
      args.onSessionId?.(sessionId)
    }
    for (const event of args.extractOutputEvents?.(line) ?? []) {
      if (event.type === 'text') assistantText = event.text
    }
    const text = args.extractAssistantText?.(line)
    if (text) assistantText = text
  }

  const structured = {
    schemaVersion: 1 as const,
    assistantText,
    blocks: assistantText ? [{ type: 'text' as const, text: assistantText }] : [],
    metrics: {
      textBlocks: assistantText ? 1 : 0,
      toolCalls: 0,
      toolFailures: 0,
    },
    truncated: false,
  }
  args.onProgress?.(structured)
  return {
    command: args.command,
    cwd: args.cwd,
    processStarted: true,
    exitCode: 0,
    signal: null,
    killed: false,
    durationMs: 1,
    stdoutTail: stdout,
    stderrTail: '',
    agentSessionId,
    assistantText,
    structured,
  }
}

function fakeHeadlessCommand(...events: Record<string, unknown>[]): string[] {
  return [TEST_HEADLESS_BIN, ...events.map((event) => JSON.stringify(event))]
}

let root: string
let wsDir: string
let service: import('./service.js').WorkspaceService | undefined
let createIssue: typeof import('./issues/mutate.js').createIssue
let savedEnv: Record<string, string | undefined>

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'issue-assignee-active-'))
  wsDir = join(root, 'fixture-workspace')
  await mkdir(wsDir, { recursive: true })
  savedEnv = {
    OPENALICE_HOME: process.env['OPENALICE_HOME'],
    AQ_LAUNCHER_ROOT: process.env['AQ_LAUNCHER_ROOT'],
    OPENALICE_GLOBAL_DIR: process.env['OPENALICE_GLOBAL_DIR'],
    HOME: process.env['HOME'],
    USERPROFILE: process.env['USERPROFILE'],
  }
  process.env['OPENALICE_HOME'] = root
  process.env['AQ_LAUNCHER_ROOT'] = join(root, 'launcher')
  process.env['OPENALICE_GLOBAL_DIR'] = join(root, 'global')
  process.env['HOME'] = root
  process.env['USERPROFILE'] = root

  // paths.ts captures OPENALICE_HOME during module evaluation. A reset plus
  // dynamic imports keeps this real-service test isolated from user state.
  vi.resetModules()
  const serviceModule = await import('./service.js')
  const mutateModule = await import('./issues/mutate.js')
  createIssue = mutateModule.createIssue
  service = await serviceModule.createWorkspaceService({
    webPort: 0,
    mcpPort: 0,
    toolBaseUrl: 'http://127.0.0.1:0/cli',
    scheduleScannerIntervalMs: 600_000,
    runHeadlessTask: completeFakeHeadlessTask,
  })
  await service.registry.add({
    id: 'ws-1',
    tag: 'ws-1',
    dir: wsDir,
    createdAt: new Date(0).toISOString(),
  })
  // Codex prepareWorkspace writes ~/.codex/config.toml trust entries. This
  // spec is about Issue ownership, not that side effect.
  const adapter = service.adapters.get('codex')
  if (adapter?.lifecycle?.prepareWorkspace) {
    vi.spyOn(adapter.lifecycle, 'prepareWorkspace').mockResolvedValue(undefined)
  }
})

afterEach(async () => {
  await service?.dispose('issue assignee activity test')
  service = undefined
  restoreEnv('OPENALICE_HOME', savedEnv.OPENALICE_HOME)
  restoreEnv('AQ_LAUNCHER_ROOT', savedEnv.AQ_LAUNCHER_ROOT)
  restoreEnv('OPENALICE_GLOBAL_DIR', savedEnv.OPENALICE_GLOBAL_DIR)
  restoreEnv('HOME', savedEnv.HOME)
  restoreEnv('USERPROFILE', savedEnv.USERPROFILE)
  vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

describe('WorkspaceService Issue assignee activity', () => {
  it('reports running terminal and WebPi owners as active', async () => {
    const { SessionPool } = await import('./session-pool.js')
    const { WebSessionHost } = await import('./web-session-host.js')
    vi.spyOn(SessionPool.prototype, 'spawn').mockReturnValue({
      pid: 123, completed: new Promise(() => {}), waitForFirstExit: async () => null, disposeAndWait: async () => {},
    } as never)
    vi.spyOn(WebSessionHost.prototype, 'start').mockImplementation(async (_input, complete) => {
      complete?.(new Promise(() => {})); return { phase: 'idle', pid: 456 } as never
    })
    for (const fixture of [
      { resumeId: 'resume-kind-owl-abc123', issueId: 'terminal-owner', surface: 'terminal' as const },
      { resumeId: 'resume-calm-fox-def456', issueId: 'webpi-owner', surface: 'webpi' as const },
    ]) {
      await service!.sessionCoordinator.ensure({
        resumeId: fixture.resumeId,
        wsId: 'ws-1',
        agent: 'codex',
        namePrefix: 'x',
        agentSessionId: `native-${fixture.surface}`,
        surface: fixture.surface,
        now: 1_000,
      })
      const record = service!.sessionRegistry.findByResumeId('ws-1', fixture.resumeId)!
      if (fixture.surface === 'terminal') await service!.executions.terminal('ws-1', { recordId: record.id, recordName: record.name }, { kind: 'user', entry: 'test-terminal' })
      else await service!.executions.web(service!.registry.get('ws-1')!, record, { kind: 'user', entry: 'test-web' })
      const created = await createIssue(wsDir, {
        id: fixture.issueId,
        title: `${fixture.surface} owner`,
        assignee: `@${fixture.resumeId}`,
      })
      expect(created.ok).toBe(true)

      const detail = await service!.issueDetail('ws-1', fixture.issueId)
      expect(detail?.assigneeSession).toMatchObject({
        resumeId: fixture.resumeId,
        state: 'ready',
        active: true,
      })
    }
  })
})

it('hands a fresh-owner comment to the configured runtime and persists the new owner', async () => {
  const { createWorkspaceConversationControl } = await import('./conversation-control.js')
  const { appendIssueComment, readIssueComments, updateIssueCommentDelivery } = await import('./issues/comments.js')
  const { dispatchIssueCommentReply } = await import('./issues/comment-delivery.js')
  await service!.catalog.recordCreated(service!.registry.get('ws-1')!)
  const adapter = service!.adapters.get('codex')!
  const command = vi.spyOn(adapter, 'composeHeadlessCommand').mockReturnValue(fakeHeadlessCommand(
    { type: 'thread.started', thread_id: 'native-handoff' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'HANDOFF_OK' } },
  ))
  try {
    const created = await createIssue(wsDir, { id: 'handoff', title: 'Handoff',
      when: { kind: 'every', every: '4h' }, assignee: '@new-then-resume',
      agent: 'codex', credentialSource: 'native', model: 'gpt-5.6-sol', effort: 'medium',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await service!.provenanceStore.append({ artifact: { kind: 'issue', workspaceId: 'ws-1', issueId: 'handoff' },
      action: 'created', origin: { kind: 'session', workspaceId: 'ws-1', resumeId: 'resume-old-pi', agent: 'pi' }, at: Date.now() })
    const added = await appendIssueComment(wsDir, 'handoff', 'human', 'Hello')
    if (!added.ok) throw new Error('Could not append fixture comment')
    const result = await dispatchIssueCommentReply({ conversation: createWorkspaceConversationControl(service!),
      issueWorkspaceId: 'ws-1', issue: created.issue, comment: added.comment, source: { kind: 'human' } })
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'scheduled' })
    if (result.status !== 'scheduled') return
    expect((await updateIssueCommentDelivery(wsDir, 'handoff', added.comment.id, result.delivery)).ok).toBe(true)
    const taskId = result.delivery.taskId
    await vi.waitFor(() => expect(service!.headlessTasks.get(taskId)?.status).toBe('done'), { timeout: 10000 })
    const task = service!.headlessTasks.get(taskId)!
    expect(task).toMatchObject({ agent: 'codex', model: 'gpt-5.6-sol', effort: 'medium' })
    expect(task.resumeId).not.toBe('resume-old-pi')
    expect((await service!.issueDetail('ws-1', 'handoff'))?.issue.assignee).toBe('@' + task.resumeId)
    expect(command).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => {
      const comments = await readIssueComments(wsDir, 'handoff')
      expect(comments.ok && comments.comments.some((entry) => entry.replyTo === added.comment.id && entry.markdown === 'HANDOFF_OK')).toBe(true)
      expect(service!.isResumeActive(task.resumeId)).toBe(false)
    }, { timeout: 10000 })
  } finally { command.mockRestore() }
}, 20000)

it.each(['terminal', 'webpi'] as const)('hands %s ownership to an Issue turn and excludes a racing dispatch', async (surface) => {
  await service!.catalog.recordCreated(service!.registry.get('ws-1')!)
  const resumeId = 'resume-handoff-owner'
  const { session } = await service!.sessionCoordinator.ensure({
    resumeId, wsId: 'ws-1', agent: 'codex', namePrefix: 'c',
    agentSessionId: 'native-handoff-owner', surface,
  })
  const adapter = service!.adapters.get('codex')!
  const command = vi.spyOn(adapter, 'composeHeadlessCommand').mockReturnValue(fakeHeadlessCommand(
    { type: 'item.completed', item: { type: 'agent_message', text: 'TAKEOVER_OK' } },
  ))
  let release!: () => void
  const stopped = new Promise<void>((resolve) => { release = resolve })
  const stop = vi.fn(async () => { await stopped; return true })
  const { SessionPool } = await import('./session-pool.js')
  const { WebSessionHost } = await import('./web-session-host.js')
  const terminal = vi.spyOn(SessionPool.prototype, 'spawn').mockReturnValue({
    recordId: session.id, pid: 123, completed: new Promise(() => {}),
    waitForFirstExit: async () => null, disposeAndWait: stop,
  } as never)
  const web = vi.spyOn(WebSessionHost.prototype, 'stop').mockImplementation(stop)
  vi.spyOn(WebSessionHost.prototype, 'start').mockImplementation(async (_input, complete) => {
    complete?.(new Promise(() => {})); return { phase: 'idle', pid: 456 } as never
  })
  if (surface === 'terminal') await service!.executions.terminal('ws-1', { recordId: session.id, recordName: session.name, agentId: 'codex' }, { kind: 'user', entry: 'test-terminal' })
  else await service!.executions.web(service!.registry.get('ws-1')!, session, { kind: 'user', entry: 'test-web' })
  try {
    const ws = service!.registry.get('ws-1')!
    const trigger = { kind: 'issue' as const, workspaceId: ws.id, issueId: 'handoff' }
    const pending = service!.executions.dispatch(ws, adapter, 'Reply', { kind: 'issue', entry: 'test-issue' }, undefined, trigger, resumeId)
    await vi.waitFor(() => expect(service!.executions.takeovers.list()).toHaveLength(1))
    expect(stop).not.toHaveBeenCalled()
    expect(service!.isResumeActive(resumeId)).toBe(false)
    const approval = service!.executions.takeovers.decide(service!.executions.takeovers.list()[0].id, 'approve')
    await vi.waitFor(() => expect(stop).toHaveBeenCalled())
    expect(command).not.toHaveBeenCalled()
    const duplicate = service!.executions.dispatch(ws, adapter, 'Duplicate', { kind: 'issue', entry: 'test-issue' }, undefined, trigger, resumeId)
    await vi.waitFor(() => expect(service!.executions.takeovers.list()).toHaveLength(2))
    await service!.executions.takeovers.decide(service!.executions.takeovers.list()[1].id, 'reject')
    await expect(duplicate).rejects.toThrow('declined')
    release()
    await approval
    release()
    const result = await pending
    await vi.waitFor(() => expect(service!.headlessTasks.get(result.taskId)?.status).toBe('done'), { timeout: 10000 })
    expect(service!.sessionRegistry.get(ws.id, session.id)?.state).toBe('paused')
    expect(service!.isResumeActive(resumeId)).toBe(false)
  } finally { release(); terminal.mockRestore(); web.mockRestore(); command.mockRestore() }
})

it('persists explicit conversation edits while keeping busy and Issue dispatches from changing them', async () => {
  const { createWorkspaceConversationControl } = await import('./conversation-control.js')
  await service!.catalog.recordCreated(service!.registry.get('ws-1')!)
  const resumeId = 'resume-selection-test'
  await service!.sessionCoordinator.ensure({
    resumeId, wsId: 'ws-1', agent: 'codex', namePrefix: 'c',
    agentSessionId: 'native-selection-test', surface: 'headless',
    runtimeBinding: { version: 1, credential: { source: 'native' }, model: 'test-model', reasoningEffort: 'medium' },
  })
  const adapter = service!.adapters.get('codex')!
  const command = vi.spyOn(adapter, 'composeHeadlessCommand').mockReturnValue(fakeHeadlessCommand(
    { type: 'item.completed', item: { type: 'agent_message', text: 'OK' } },
  ))
  try {
    const control = createWorkspaceConversationControl(service!)
    const input = { target: { kind: 'resume' as const, resumeId }, prompt: 'reply', selection: { reasoningEffort: 'high' as const } }
    service!.claimResume(resumeId)
    await expect(control.ask(input)).rejects.toMatchObject({ code: 'busy' })
    expect(service!.resumeRegistry.get(resumeId)?.runtimeBinding?.reasoningEffort).toBe('medium')
    service!.releaseResume(resumeId)
    const result = await control.ask(input)
    if (result.status !== 'dispatched') throw new Error('not dispatched')
    await vi.waitFor(() => expect(service!.isResumeActive(resumeId)).toBe(false), { timeout: 10000 })
    expect(service!.headlessTasks.get(result.taskId)).toMatchObject({ model: 'test-model', effort: 'high', status: 'done' })
    expect(service!.resumeRegistry.get(resumeId)?.runtimeBinding).toMatchObject({ model: 'test-model', reasoningEffort: 'high' })
    await expect(service!.executions.dispatch(service!.registry.get('ws-1')!, adapter, 'issue', { kind: 'issue', entry: 'test-issue' }, undefined,
      { kind: 'issue', workspaceId: 'ws-1', issueId: 'test' }, resumeId, undefined, { model: 'other-model' }))
      .rejects.toMatchObject({ code: 'not_ready' })
    expect(service!.resumeRegistry.get(resumeId)?.runtimeBinding?.model).toBe('test-model')
  } finally { command.mockRestore() }
})
