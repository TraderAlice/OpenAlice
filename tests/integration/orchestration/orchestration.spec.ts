import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryEntityStore } from '../../../src/core/entity-store.js'
import { createMemoryInboxStore } from '../../../src/core/inbox-store.js'
import { ToolCenter } from '../../../src/core/tool-center.js'
import { WorkspaceToolCenter } from '../../../src/core/workspace-tool-center.js'
import { registerCliRoutes } from '../../../src/server/cli.js'
import { orchestrationToolFactories } from '../../../src/tool/orchestration-tools.js'

interface SpawnRecord {
  readonly index: number
  readonly prompt: string
  readonly resumeSessionId?: string
}

let root: string
let wsDir: string
let originalEnv: NodeJS.ProcessEnv
let service: import('../../../src/workspaces/service.js').WorkspaceService
let app: Hono
let spawns: SpawnRecord[]
let gateFiles: Map<number, string>
let assistantTexts: Map<number, string>

function buildCodexFixtureCommand(opts: {
  threadId: string
  assistantText: string
  gateFile?: string
}): string[] {
  const script = `
const fs = require('node:fs');
const threadId = ${JSON.stringify(opts.threadId)};
const text = ${JSON.stringify(opts.assistantText)};
const gateFile = ${JSON.stringify(opts.gateFile ?? null)};
console.log(JSON.stringify({ type: 'thread.started', thread_id: threadId }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text, phase: 'final_answer' } }));
function finish() {
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
  process.exit(0);
}
if (!gateFile) {
  setTimeout(finish, 25);
} else {
  const timer = setInterval(() => {
    if (fs.existsSync(gateFile)) {
      clearInterval(timer);
      finish();
    }
  }, 20);
}
`
  return [process.execPath, '-e', script]
}

async function invokeCliTool<T = Record<string, unknown>>(
  tool: string,
  args: Record<string, unknown>,
  runId?: string,
): Promise<{ status: number; payload: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (runId) headers['x-openalice-run'] = runId
  const res = await app.request('/cli/ws/data/invoke', {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool, args }),
  })
  const raw = (await res.json()) as { content?: Array<{ type: string; text?: string }>; error?: string }
  if (res.status !== 200) {
    return { status: res.status, payload: raw as unknown as T }
  }
  const text = (raw.content ?? []).map((b) => b.text ?? '').join('')
  return { status: res.status, payload: JSON.parse(text) as T }
}

async function waitForRunDone(taskId: string) {
  await vi.waitFor(
    () => {
      const rec = service.headlessTasks.get(taskId)
      expect(rec, `missing task ${taskId}`).toBeTruthy()
      expect(rec!.status, rec!.error).toBe('done')
      expect(service.isResumeActive(rec!.resumeId)).toBe(false)
    },
    { timeout: 10_000 },
  )
  return service.headlessTasks.get(taskId)!
}

async function waitForNativeSessionId(resumeId: string) {
  await vi.waitFor(
    () => {
      expect(service.resumeRegistry.get(resumeId)?.agentSessionId).toBeTruthy()
    },
    { timeout: 10_000 },
  )
}

beforeEach(async () => {
  originalEnv = { ...process.env }
  root = await mkdtemp(join(tmpdir(), 'orchestration-e2e-'))
  wsDir = join(root, 'workspace')
  await mkdir(wsDir, { recursive: true })
  spawns = []
  gateFiles = new Map()
  assistantTexts = new Map()

  process.env['OPENALICE_HOME'] = root
  process.env['AQ_LAUNCHER_ROOT'] = join(root, 'launcher')
  process.env['OPENALICE_GLOBAL_DIR'] = join(root, 'global')
  vi.resetModules()

  const { createWorkspaceService } = await import('../../../src/workspaces/service.js')
  service = await createWorkspaceService({
    webPort: 0,
    mcpPort: 0,
    toolBaseUrl: 'http://127.0.0.1:0/cli',
    scheduleScannerIntervalMs: 600_000,
  })
  await service.registry.add({
    id: 'ws',
    tag: 'desk',
    dir: wsDir,
    createdAt: new Date(0).toISOString(),
  })
  await service.catalog.recordCreated(service.registry.get('ws')!)

  const adapter = service.adapters.get('codex')!
  if (adapter.lifecycle?.prepareWorkspace) {
    vi.spyOn(adapter.lifecycle, 'prepareWorkspace').mockResolvedValue()
  }
  vi.spyOn(adapter, 'composeHeadlessCommand').mockImplementation((_base, spawnCtx, prompt) => {
    const index = spawns.length
    const resumeSessionId =
      typeof spawnCtx.resume === 'object' && spawnCtx.resume !== null
        ? spawnCtx.resume.sessionId
        : undefined
    spawns.push({
      index,
      prompt,
      ...(resumeSessionId ? { resumeSessionId } : {}),
    })
    const threadId = resumeSessionId ?? `native-thread-${index}`
    const assistantText = assistantTexts.get(index) ?? `TURN_${index}_OK`
    const gateFile = gateFiles.get(index)
    return buildCodexFixtureCommand({ threadId, assistantText, gateFile })
  })

  const workspaceToolCenter = new WorkspaceToolCenter()
  for (const factory of orchestrationToolFactories) {
    workspaceToolCenter.register(factory)
  }
  app = new Hono()
  registerCliRoutes(app, {
    toolCenter: new ToolCenter(),
    workspaceToolCenter,
    inboxStore: createMemoryInboxStore(),
    entityStore: createMemoryEntityStore(),
    getWorkspaceService: () => service,
  })
})

afterEach(async () => {
  await service?.dispose('orchestration e2e test')
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
  vi.restoreAllMocks()
  vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

describe('orchestration E2E round-trip (WorkspaceService + CLI gateway + tools)', () => {
  it('completes worker-start -> ask -> parent wake -> reply -> worker-done -> completion wake -> check & inbox', async () => {
    // 0. Establish a real settled parent Session so deliverToHeadless can wake it.
    const { createWorkspaceConversationControl } = await import(
      '../../../src/workspaces/conversation-control.js'
    )
    const conversation = createWorkspaceConversationControl(service)
    const parentInit = await conversation.ask({
      target: { kind: 'workspace', workspaceId: 'ws' },
      agent: 'codex',
      prompt: 'Initialize coordinator session',
      source: { kind: 'human' },
    })
    if (parentInit.status === 'unavailable') throw new Error('parent init unavailable')
    await waitForRunDone(parentInit.taskId)

    // Gate worker turn 1 (spawn index 1) until the worker calls `ask`.
    const gate1 = join(root, 'gate-worker-1')
    gateFiles.set(1, gate1)

    // 1. Coordinator dispatches worker via CLI gateway `orchestration_worker_start`.
    const started = await invokeCliTool<{
      ok: boolean
      taskId: string
      dispatchId: string
      status: string
      headlessTaskId: string
      workerResumeId: string
    }>(
      'orchestration_worker_start',
      {
        spec: 'Run momentum backtest on SPY and report metrics.',
        wsId: 'ws',
        agent: 'codex',
      },
      parentInit.taskId,
    )
    expect(started.status).toBe(200)
    expect(started.payload).toMatchObject({
      ok: true,
      status: 'running',
    })
    const { dispatchId, workerResumeId, headlessTaskId: workerRun1 } = started.payload

    await waitForNativeSessionId(workerResumeId)

    // Verify Preamble contract was injected into worker turn 1.
    expect(spawns[1]?.prompt).toContain('[Orchestration Worker Contract]')
    expect(spawns[1]?.prompt).toContain(`Dispatch ID: ${dispatchId}`)
    expect(spawns[1]?.prompt).toContain(`alice orchestration ask --dispatch ${dispatchId} --body`)
    expect(spawns[1]?.prompt).toContain(`alice orchestration worker-done --dispatch ${dispatchId} --outcome`)

    // 2. Worker asks coordinator a question via `orchestration_ask`.
    const asked = await invokeCliTool<{
      ok: boolean
      messageId: string
      status: string
      wakeResult: string
    }>(
      'orchestration_ask',
      {
        dispatch: dispatchId,
        subject: 'Bar interval',
        body: 'Should I use daily or hourly SPY bars?',
      },
      workerRun1,
    )
    expect(asked.status).toBe(200)
    expect(asked.payload).toMatchObject({
      ok: true,
      status: 'waiting_parent',
      wakeResult: 'delivered',
    })
    const questionId = asked.payload.messageId

    // Release worker turn 1 so it exits cleanly while waiting for parent reply.
    await writeFile(gate1, 'go')
    await waitForRunDone(workerRun1)

    // Verify parent received inline wake for the question and settled cleanly.
    let parentQuestionWakeRunId = ''
    await vi.waitFor(() => {
      const parentRuns = service.headlessTasks
        .list({ wsId: 'ws' })
        .filter((t) => t.resumeId === parentInit.resumeId)
      expect(parentRuns.length).toBeGreaterThanOrEqual(2)
      parentQuestionWakeRunId = parentRuns[0]!.taskId
    })
    await waitForRunDone(parentQuestionWakeRunId)

    const parentWakeSpawn = spawns.find(
      (s) => s.prompt.includes('[Orchestration Wake') && s.prompt.includes('[question]'),
    )
    expect(parentWakeSpawn?.prompt).toContain(questionId)
    expect(parentWakeSpawn?.prompt).toContain('Should I use daily or hourly SPY bars?')
    expect(parentWakeSpawn?.prompt).toContain(
      `alice orchestration reply --id ${questionId} --body`,
    )

    // Verify worker turn 1 exit did NOT trigger a false `stopped_without_done` escalation.
    expect(service.orchestration.getTask(dispatchId)?.status).toBe('waiting_parent')

    // Gate worker turn 2 (next spawn) until worker calls `worker-done`.
    const gate2 = join(root, 'gate-worker-2')
    const workerTurn2SpawnIdx = spawns.length
    gateFiles.set(workerTurn2SpawnIdx, gate2)

    // 3. Parent replies to question via `orchestration_reply`.
    const replied = await invokeCliTool<{
      ok: boolean
      questionId: string
      replyId: string
      status: string
      wakeResult: string
    }>(
      'orchestration_reply',
      {
        id: questionId,
        body: 'Use daily bars from 2018-2025.',
      },
      parentQuestionWakeRunId,
    )
    expect(replied.status).toBe(200)
    expect(replied.payload).toMatchObject({
      ok: true,
      questionId,
      status: 'running',
      wakeResult: 'delivered',
    })

    // Verify worker resumed with the inline reply prompt.
    await vi.waitFor(() => expect(spawns[workerTurn2SpawnIdx]).toBeDefined(), { timeout: 10_000 })
    const workerTurn2Prompt = spawns[workerTurn2SpawnIdx]?.prompt ?? ''
    expect(workerTurn2Prompt).toContain('[reply]')
    expect(workerTurn2Prompt).toContain(`In-Reply-To: ${questionId}`)
    expect(workerTurn2Prompt).toContain('Use daily bars from 2018-2025.')

    const workerRun2 = service.orchestration.getTask(dispatchId)!.headlessTaskId!
    expect(workerRun2).not.toBe(workerRun1)

    // 4. Worker reports completion via `orchestration_worker_done` (both deliverables + deliverable).
    const completed = await invokeCliTool<{
      ok: boolean
      status: string
      outcome: string
      wakeResult: string
    }>(
      'orchestration_worker_done',
      {
        dispatch: dispatchId,
        outcome: 'completed',
        summary: 'Daily SPY momentum backtest finished with Sharpe 1.62.',
        evidence: 'runId=run-spy-01, valSharpe=1.62, holdout_unlocks=0',
        deliverables: JSON.stringify([
          { path: 'projects/spy/research.md', summary: 'Primary research brief' },
        ]),
        deliverable: ['projects/spy/runs/run-spy-01/run.json'],
      },
      workerRun2,
    )
    expect(completed.status).toBe(200)
    expect(completed.payload).toMatchObject({
      ok: true,
      status: 'done',
      outcome: 'completed',
      wakeResult: 'delivered',
    })

    await writeFile(gate2, 'go')
    await waitForRunDone(workerRun2)

    // Verify parent received completion wake.
    let parentDoneWakeRunId = ''
    await vi.waitFor(() => {
      const parentRuns = service.headlessTasks
        .list({ wsId: 'ws' })
        .filter((t) => t.resumeId === parentInit.resumeId)
      expect(parentRuns.length).toBeGreaterThanOrEqual(3)
      parentDoneWakeRunId = parentRuns[0]!.taskId
    })
    await waitForRunDone(parentDoneWakeRunId)

    const doneWakeSpawn = spawns.find(
      (s) => s.prompt.includes('[Orchestration Wake') && s.prompt.includes('[worker_done]'),
    )
    expect(doneWakeSpawn?.prompt).toContain('Outcome: completed')
    expect(doneWakeSpawn?.prompt).toContain('Daily SPY momentum backtest finished with Sharpe 1.62.')
    expect(doneWakeSpawn?.prompt).toContain('projects/spy/research.md')
    expect(doneWakeSpawn?.prompt).toContain('projects/spy/runs/run-spy-01/run.json')

    // 5. Parent calls `check` (acks pending `worker_done`), then `check` again (empty),
    //    then `inbox` (still returns full audit history including already-acked messages!).
    const check1 = await invokeCliTool<{
      ok: boolean
      count: number
      messages: Array<{ kind: string; status: string }>
    }>('orchestration_check', {}, parentDoneWakeRunId)
    expect(check1.payload.ok).toBe(true)
    expect(check1.payload.count).toBe(1)
    expect(check1.payload.messages[0]).toMatchObject({ kind: 'worker_done', status: 'acked' })

    const check2 = await invokeCliTool<{ ok: boolean; count: number }>(
      'orchestration_check',
      {},
      parentDoneWakeRunId,
    )
    expect(check2.payload).toMatchObject({ ok: true, count: 0 })

    const inbox = await invokeCliTool<{
      ok: boolean
      count: number
      messages: Array<{ kind: string; status: string; dispatchId: string }>
    }>('orchestration_inbox', { dispatch: `dispatch:${dispatchId}` }, parentDoneWakeRunId)
    expect(inbox.payload.ok).toBe(true)
    expect(inbox.payload.count).toBe(2)
    expect(inbox.payload.messages.map((m) => m.kind)).toEqual(['worker_done', 'question'])
    expect(inbox.payload.messages.every((m) => m.status === 'acked')).toBe(true)

    // 6. Verify `worker-list` reflects final settled state and deliverables.
    const listed = await invokeCliTool<{
      ok: boolean
      count: number
      workers: Array<{ dispatchId: string; status: string; outcome: string; deliverables: unknown[] }>
    }>('orchestration_worker_list', { dispatch: dispatchId }, parentDoneWakeRunId)
    expect(listed.payload).toMatchObject({
      ok: true,
      count: 1,
      workers: [
        expect.objectContaining({
          dispatchId,
          status: 'done',
          outcome: 'completed',
          deliverables: [
            { path: 'projects/spy/research.md', summary: 'Primary research brief' },
            { path: 'projects/spy/runs/run-spy-01/run.json' },
          ],
        }),
      ],
    })
  }, 25_000)

  it('escalates stopped_without_done when worker exits silently and recovers via send', async () => {
    const { createWorkspaceConversationControl } = await import(
      '../../../src/workspaces/conversation-control.js'
    )
    const conversation = createWorkspaceConversationControl(service)
    const parentInit = await conversation.ask({
      target: { kind: 'workspace', workspaceId: 'ws' },
      agent: 'codex',
      prompt: 'Initialize coordinator session',
      source: { kind: 'human' },
    })
    if (parentInit.status === 'unavailable') throw new Error('parent init unavailable')
    await waitForRunDone(parentInit.taskId)

    // Worker turn 1 (spawn index 1) exits immediately with plain text and NO ask/worker-done.
    assistantTexts.set(1, 'I checked the data but forgot to call worker-done.')

    const started = await invokeCliTool<{
      ok: boolean
      dispatchId: string
      headlessTaskId: string
      workerResumeId: string
    }>(
      'orchestration_worker_start',
      {
        spec: 'Check latest CPI release and report via worker-done.',
        wsId: 'ws',
        agent: 'codex',
      },
      parentInit.taskId,
    )
    expect(started.status).toBe(200)
    const { dispatchId, headlessTaskId: workerRun1 } = started.payload

    // Wait for worker turn 1 to settle without calling worker-done/ask.
    await waitForRunDone(workerRun1)

    // Verify task escalated to `failed` / `stopped_without_done` and parent received escalation wake.
    let parentEscWakeRunId = ''
    await vi.waitFor(() => {
      expect(service.orchestration.getTask(dispatchId)).toMatchObject({
        status: 'failed',
        stopReason: 'stopped_without_done',
      })
      const parentRuns = service.headlessTasks
        .list({ wsId: 'ws' })
        .filter((t) => t.resumeId === parentInit.resumeId)
      expect(parentRuns.length).toBeGreaterThanOrEqual(2)
      parentEscWakeRunId = parentRuns[0]!.taskId
    })
    await waitForRunDone(parentEscWakeRunId)

    const escWakeSpawn = spawns.find(
      (s) => s.prompt.includes('[Orchestration Wake') && s.prompt.includes('[escalation]'),
    )
    expect(escWakeSpawn?.prompt).toContain('Stop Reason: stopped_without_done')
    expect(escWakeSpawn?.prompt).toContain('I checked the data but forgot to call worker-done.')
    expect(escWakeSpawn?.prompt).toContain(
      `alice orchestration send --to dispatch:${dispatchId} --body`,
    )

    // Gate worker turn 2 so we can invoke `worker-done` while it runs.
    const gate2 = join(root, 'gate-recovery-worker-2')
    const recoverySpawnIdx = spawns.length
    gateFiles.set(recoverySpawnIdx, gate2)

    // Parent steers the escalated worker via `orchestration_send` using `dispatch:<id>`.
    const steered = await invokeCliTool<{
      ok: boolean
      mode: string
      status: string
      turnCount: number
      headlessTaskId: string
    }>(
      'orchestration_send',
      {
        to: `dispatch:${dispatchId}`,
        subject: 'Report properly',
        body: 'Please submit your findings using worker-done now.',
      },
      parentEscWakeRunId,
    )
    expect(steered.status).toBe(200)
    expect(steered.payload).toMatchObject({
      ok: true,
      mode: 'resumed',
      status: 'running',
      turnCount: 2,
    })

    await vi.waitFor(() => expect(spawns[recoverySpawnIdx]).toBeDefined(), { timeout: 10_000 })
    const recoveryPrompt = spawns[recoverySpawnIdx]?.prompt ?? ''
    expect(recoveryPrompt).toContain('[send]')
    expect(recoveryPrompt).toContain('Please submit your findings using worker-done now.')

    const workerRun2 = steered.payload.headlessTaskId
    const done = await invokeCliTool<{ ok: boolean; status: string; outcome: string }>(
      'orchestration_worker_done',
      {
        dispatch: dispatchId,
        outcome: 'completed',
        summary: 'Latest CPI is 2.8% YoY.',
      },
      workerRun2,
    )
    expect(done.status).toBe(200)
    expect(done.payload).toMatchObject({ ok: true, status: 'done', outcome: 'completed' })

    await writeFile(gate2, 'go')
    await waitForRunDone(workerRun2)

    // Parent receives completion wake and inbox retains both the escalation and worker_done.
    await vi.waitFor(() => {
      const parentRuns = service.headlessTasks
        .list({ wsId: 'ws' })
        .filter((t) => t.resumeId === parentInit.resumeId)
      expect(parentRuns.length).toBeGreaterThanOrEqual(3)
    })

    const inbox = await invokeCliTool<{
      ok: boolean
      count: number
      messages: Array<{ kind: string }>
    }>('orchestration_inbox', { dispatch: dispatchId }, parentEscWakeRunId)
    expect(inbox.payload.ok).toBe(true)
    expect(inbox.payload.messages.map((m) => m.kind)).toEqual(['worker_done', 'escalation'])
  }, 25_000)

  it('executes real `alice orchestration` CLI shim flags end-to-end (including repeatable --deliverable and worker-stop)', async () => {
    const { createWorkspaceConversationControl } = await import(
      '../../../src/workspaces/conversation-control.js'
    )
    const conversation = createWorkspaceConversationControl(service)
    const parentInit = await conversation.ask({
      target: { kind: 'workspace', workspaceId: 'ws' },
      agent: 'codex',
      prompt: 'Initialize coordinator session',
      source: { kind: 'human' },
    })
    if (parentInit.status === 'unavailable') throw new Error('parent init unavailable')
    await waitForRunDone(parentInit.taskId)

    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
    if (!server.listening) {
      await new Promise<void>((r) => server.once('listening', r))
    }
    const { port } = server.address() as { port: number }
    const execAlice = async <T = Record<string, unknown>>(args: string[], runId: string): Promise<T> => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [resolve('src/workspaces/cli/bin/openalice-cli.cjs'), ...args],
        {
          env: {
            ...process.env,
            OPENALICE_CLI_BIN: 'alice',
            AQ_WS_ID: 'ws',
            AQ_RUN_ID: runId,
            OPENALICE_TOOL_SOCKET: '',
            OPENALICE_TOOL_URL: `http://127.0.0.1:${port}/cli`,
          },
          timeout: 10_000,
        },
      )
      return JSON.parse(stdout) as T
    }

    try {
      const gate1 = join(root, 'gate-shim-1')
      gateFiles.set(1, gate1)

      const started = await execAlice<{
        ok: boolean
        dispatchId: string
        headlessTaskId: string
        workerResumeId: string
      }>(
        [
          'orchestration',
          'worker-start',
          '--ws-id',
          'ws',
          '--agent',
          'codex',
          '--max-idle-ms',
          '60000',
          '--spec',
          'Produce two markdown artifacts and report via worker-done.',
        ],
        parentInit.taskId,
      )
      expect(started.ok).toBe(true)
      await waitForNativeSessionId(started.workerResumeId)

      const listed = await execAlice<{ ok: boolean; count: number; workers: Array<{ dispatchId: string }> }>(
        ['orchestration', 'worker-list', '--status', 'running', '--limit', '10'],
        parentInit.taskId,
      )
      expect(listed).toMatchObject({
        ok: true,
        count: 1,
        workers: [expect.objectContaining({ dispatchId: started.dispatchId })],
      })

      const done = await execAlice<{
        ok: boolean
        status: string
        outcome: string
        deliverables: Array<{ path: string; summary?: string }>
      }>(
        [
          'orchestration',
          'worker-done',
          '--dispatch',
          started.dispatchId,
          '--outcome',
          'completed',
          '--summary',
          'Created both artifacts.',
          '--evidence',
          'All assertions green.',
          '--deliverable',
          'reports/one.md',
          '--deliverable',
          '{"path":"reports/two.md","summary":"Second report"}',
        ],
        started.headlessTaskId,
      )
      expect(done).toMatchObject({
        ok: true,
        status: 'done',
        outcome: 'completed',
        deliverables: [
          { path: 'reports/one.md' },
          { path: 'reports/two.md', summary: 'Second report' },
        ],
      })

      await writeFile(gate1, 'go')
      await waitForRunDone(started.headlessTaskId)

      let parentDoneRunId = ''
      await vi.waitFor(() => {
        const parentRuns = service.headlessTasks
          .list({ wsId: 'ws' })
          .filter((t) => t.resumeId === parentInit.resumeId)
        expect(parentRuns.length).toBeGreaterThanOrEqual(2)
        parentDoneRunId = parentRuns[0]!.taskId
      })
      await waitForRunDone(parentDoneRunId)

      const checked = await execAlice<{ ok: boolean; count: number }>(
        ['orchestration', 'check'],
        parentDoneRunId,
      )
      expect(checked).toMatchObject({ ok: true, count: 1 })

      const inbox = await execAlice<{ ok: boolean; count: number; messages: Array<{ kind: string; status: string }> }>(
        ['orchestration', 'inbox', '--dispatch', `dispatch:${started.dispatchId}`, '--limit', '5'],
        parentDoneRunId,
      )
      expect(inbox).toMatchObject({
        ok: true,
        count: 1,
        messages: [expect.objectContaining({ kind: 'worker_done', status: 'acked' })],
      })

      const stopped = await execAlice<{ ok: boolean; status: string; stopReason: string }>(
        ['orchestration', 'worker-stop', '--dispatch', `dispatch:${started.dispatchId}`, '--reason', 'manual close'],
        parentDoneRunId,
      )
      expect(stopped).toMatchObject({
        ok: true,
        status: 'stopped',
        stopReason: 'manual close',
      })
    } finally {
      if ('closeAllConnections' in server) server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }, 25_000)
})
