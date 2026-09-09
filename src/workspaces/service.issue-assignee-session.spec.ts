import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  }
  process.env['OPENALICE_HOME'] = root
  process.env['AQ_LAUNCHER_ROOT'] = join(root, 'launcher')
  process.env['OPENALICE_GLOBAL_DIR'] = join(root, 'global')

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
  })
  await service.registry.add({
    id: 'ws-1',
    tag: 'ws-1',
    dir: wsDir,
    createdAt: new Date(0).toISOString(),
  })
})

afterEach(async () => {
  await service?.dispose('issue assignee activity test')
  service = undefined
  restoreEnv('OPENALICE_HOME', savedEnv.OPENALICE_HOME)
  restoreEnv('AQ_LAUNCHER_ROOT', savedEnv.AQ_LAUNCHER_ROOT)
  restoreEnv('OPENALICE_GLOBAL_DIR', savedEnv.OPENALICE_GLOBAL_DIR)
  vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

describe('WorkspaceService Issue assignee activity', () => {
  it('reports running terminal and WebPi owners as active', async () => {
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
        state: 'running',
        surface: fixture.surface,
        now: 1_000,
      })
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
  const command = vi.spyOn(adapter, 'composeHeadlessCommand').mockReturnValue([
    process.execPath, '-e', `console.log(JSON.stringify({type:'thread.started',thread_id:'native-handoff'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'HANDOFF_OK'}}));`,
  ])
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
    agentSessionId: 'native-handoff-owner', state: 'running', surface,
  })
  const adapter = service!.adapters.get('codex')!
  const command = vi.spyOn(adapter, 'composeHeadlessCommand').mockReturnValue([
    process.execPath, '-e', `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'TAKEOVER_OK'}}));`,
  ])
  let release!: () => void
  const stopped = new Promise<void>((resolve) => { release = resolve })
  const stop = vi.fn(async () => { await stopped; return true })
  const terminal = vi.spyOn(service!.pool, 'get').mockReturnValue(surface === 'terminal'
    ? { disposeAndWait: stop } as never : undefined)
  const web = vi.spyOn(service!.web, 'stop').mockImplementation(surface === 'webpi' ? stop : async () => false)
  try {
    const ws = service!.registry.get('ws-1')!
    const trigger = { kind: 'issue' as const, workspaceId: ws.id, issueId: 'handoff' }
    const pending = service!.dispatchHeadlessTask(ws, adapter, 'Reply', undefined, trigger, resumeId)
    await vi.waitFor(() => expect(stop).toHaveBeenCalled())
    expect(command).not.toHaveBeenCalled()
    await expect(service!.dispatchHeadlessTask(ws, adapter, 'Duplicate', undefined, trigger, resumeId))
      .rejects.toMatchObject({ code: 'busy' })
    release()
    const result = await pending
    await vi.waitFor(() => expect(service!.headlessTasks.get(result.taskId)?.status).toBe('done'), { timeout: 10000 })
    expect(service!.sessionRegistry.get(ws.id, session.id)?.state).toBe('paused')
    expect(service!.isResumeActive(resumeId)).toBe(false)
  } finally { release(); terminal.mockRestore(); web.mockRestore(); command.mockRestore() }
})
