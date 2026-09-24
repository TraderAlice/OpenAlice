import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ownerChatMessageSchema, type OwnerChatMessage } from '@traderalice/connector-protocol'

let root: string
let service: import('./service.js').WorkspaceService
let server: Server
let sent: OwnerChatMessage[]
let wsDir: string
let originalEnv: NodeJS.ProcessEnv

beforeEach(async () => {
  originalEnv = { ...process.env }
  root = await mkdtemp(join(tmpdir(), 'communication-surface-'))
  wsDir = join(root, 'workspace'); await mkdir(wsDir)
  sent = []
  server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    try {
      sent.push(ownerChatMessageSchema.parse(JSON.parse(body)))
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ accepted: true, deliveryId: 'test' }))
    } catch { response.writeHead(400); response.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  process.env['OPENALICE_HOME'] = root
  process.env['AQ_LAUNCHER_ROOT'] = join(root, 'launcher')
  process.env['OPENALICE_GLOBAL_DIR'] = join(root, 'global')
  process.env['OPENALICE_CONNECTOR_URL'] = `http://127.0.0.1:${address.port}`
  vi.resetModules()
  const { createWorkspaceService } = await import('./service.js')
  service = await createWorkspaceService({ webPort: 0, mcpPort: 0, toolBaseUrl: 'http://127.0.0.1:0/cli', scheduleScannerIntervalMs: 600000 })
  await service.registry.add({ id: 'ws', tag: 'test', dir: wsDir, createdAt: new Date(0).toISOString() })
  await service.catalog.recordCreated(service.registry.get('ws')!)
  const adapter = service.adapters.get('codex')!
  // Exercise the real child process and Codex output translator, but never launch
  // a paid model or modify native credential/trust files.
  if (adapter.lifecycle?.prepareWorkspace) vi.spyOn(adapter.lifecycle, 'prepareWorkspace').mockResolvedValue()
  const events = [
    { type: 'thread.started', thread_id: 'fixture-native-session' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Checking the audit.', phase: 'commentary' } },
    { type: 'item.completed', item: { type: 'command_execution', id: 'tool-1', command: 'true', status: 'completed', exit_code: 0, aggregated_output: '' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'AUDIT_DONE', phase: 'final_answer' } },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
  ]
  vi.spyOn(adapter, 'composeHeadlessCommand').mockReturnValue([process.execPath, '-e',
    `const events=${JSON.stringify(events)}; let i=0; const timer=setInterval(()=>{ console.log(JSON.stringify(events[i++])); if(i===events.length)clearInterval(timer); },50);`])
})
afterEach(async () => {
  await service?.dispose('communication surface test')
  await new Promise<void>(resolve => server.close(() => resolve()))
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  vi.restoreAllMocks(); vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

async function waitForRun(taskId: string) {
  await vi.waitFor(() => {
    const run = service.headlessTasks.get(taskId)!
    expect(run.status, run.error).toBe('done')
    expect(service.isResumeActive(run.resumeId)).toBe(false)
  }, { timeout: 10000 })
  return service.headlessTasks.get(taskId)!
}

it.each(['unchanged', 'rebound', 'deleted'] as const)('keeps an internal ask private and completes a routed reply with the Issue %s', async mutation => {
  const { createWorkspaceConversationControl } = await import('./conversation-control.js')
  const { createIssue } = await import('./issues/mutate.js')
  const { appendIssueComment, updateIssueCommentDelivery } = await import('./issues/comments.js')
  const { dispatchIssueCommentReply } = await import('./issues/comment-delivery.js')
  const conversation = createWorkspaceConversationControl(service)
  const initial = await conversation.ask({ target: { kind: 'workspace', workspaceId: 'ws' }, agent: 'codex', prompt: 'start', source: { kind: 'human' } })
  if (initial.status === 'unavailable') throw new Error('initial unavailable')
  await waitForRun(initial.taskId)
  const created = await createIssue(wsDir, { id: 'desk', title: 'Desk', connectorDesk: 'telegram', assignee: `@${initial.resumeId}` }, { allowConnectorDesk: true })
  if (!created.ok) throw new Error('fixture issue failed')
  const origin = { kind: 'session' as const, workspaceId: 'other-workspace', resumeId: 'other-agent', agent: 'codex', execution: { kind: 'headless' as const, taskId: 'caller-task' } }
  const internal = await conversation.ask({ target: { kind: 'resume', resumeId: initial.resumeId }, prompt: 'audit', source: origin,
    subject: { kind: 'issue', workspaceId: 'ws', issueId: 'desk', relation: 'run', runId: initial.taskId } })
  if (internal.status === 'unavailable') throw new Error('internal unavailable')
  const privateRun = await waitForRun(internal.taskId)
  expect(privateRun.communication).toMatchObject({ origin, reply: { kind: 'caller' } })
  expect(privateRun.parentTaskId).toBe(initial.taskId)
  expect(sent).toEqual([])
  const comment = await appendIssueComment(wsDir, 'desk', 'human', 'Please reply', { via: 'telegram' })
  if (!comment.ok) throw new Error('fixture comment failed')
  const reply = await dispatchIssueCommentReply({ conversation, issueWorkspaceId: 'ws', issue: created.issue, comment: comment.comment, source: { kind: 'human' } })
  if (reply.status !== 'scheduled') throw new Error('reply not scheduled')
  await updateIssueCommentDelivery(wsDir, 'desk', comment.comment.id, reply.delivery)
  const issuePath = join(wsDir, '.alice/issues/desk.md')
  if (mutation === 'rebound') await writeFile(issuePath, (await readFile(issuePath, 'utf8')).replace('connectorDesk: telegram', 'connectorDesk: slack'))
  if (mutation === 'deleted') await rm(issuePath)
  const publicRun = await waitForRun(reply.delivery.taskId)
  expect(publicRun.communication).toMatchObject({ reply: { kind: 'issue-comment', commentId: comment.comment.id }, delivery: { connectorId: 'telegram' } })
  expect(sent.map(message => message.phase)).toEqual(['accepted', 'progress', 'final'])
  expect(new Set(sent.map(message => message.conversationId))).toEqual(new Set([publicRun.taskId]))
  expect(sent.at(-1)?.text).toBe('AUDIT_DONE')
  expect(sent.every(message => message.adapterId === 'telegram')).toBe(true)
  const events = (await readFile(join(root, 'launcher/state/agent-conversations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(events.find(event => event.type === 'conversation.dispatched' && event.taskId === publicRun.taskId)?.communication).toEqual(publicRun.communication)
  expect(publicRun.terminalDelivery?.state).toBe('accepted')
}, 20000)

it('interrupts a real background execution through the unified service and denies subsequent offers', async () => {
  const adapter = service.adapters.get('codex')!
  vi.mocked(adapter.composeHeadlessCommand!).mockReturnValue([process.execPath, '-e',
    'console.log(JSON.stringify({type:"thread.started",thread_id:"interrupt-fixture"})); setInterval(()=>{},1000)'])
  const ws = service.registry.get('ws')!
  const offered = await service.executions.dispatch(ws, adapter, 'test', { kind: 'schedule', entry: 'test-schedule' })
  await vi.waitFor(() => expect(service.executions.current(offered.resumeId)?.phase).toBe('running'))
  const run = service.executions.current(offered.resumeId)!
  expect(await service.executions.interrupt(offered.resumeId, run.executionId, { kind: 'user', entry: 'test-interrupt' })).toBe(true)
  await vi.waitFor(() => expect(service.headlessTasks.get(offered.taskId)?.status).toBe('interrupted'))
  expect(service.executions.list(offered.resumeId)[0]).toMatchObject({ phase: 'interrupted', reason: 'user-interrupted' })
  expect(service.executions.admission.blocks(offered.resumeId)).toHaveLength(1)
  await expect(service.executions.dispatch(ws, adapter, 'again', { kind: 'schedule', entry: 'test-schedule' }, undefined, undefined, offered.resumeId)).rejects.toMatchObject({ code: 'session_blocked' })
  expect(service.headlessTasks.get(offered.taskId)?.interruptionReason).toBe('user-interrupted')
}, 15000)
