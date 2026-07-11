import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HeadlessTaskRegistry, headlessLogPaths } from './headless-task-registry.js'
import type { Logger } from './logger.js'

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

let dir: string
let path: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'htr-'))
  path = join(dir, 'tasks.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('HeadlessTaskRegistry', () => {
  it('create → running record, listed newest-first', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const a = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'do A', startedAt: 1 })
    const b = await reg.create({ wsId: 'w2', agent: 'pi', prompt: 'do B', startedAt: 2 })
    expect(a.status).toBe('running')
    expect(reg.list().map((t) => t.taskId)).toEqual([b.taskId, a.taskId]) // newest-first
    expect(reg.runningCount()).toBe(2)
  })

  it('complete updates status; get returns it; runningCount drops', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const a = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x', startedAt: 1 })
    await reg.complete(a.taskId, { status: 'done', exitCode: 0, durationMs: 5, finishedAt: 2 })
    expect(reg.get(a.taskId)?.status).toBe('done')
    expect(reg.get(a.taskId)?.exitCode).toBe(0)
    expect(reg.runningCount()).toBe(0)
  })

  it('list filters by wsId / status / limit', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const a = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x', startedAt: 1 })
    await reg.create({ wsId: 'w2', agent: 'pi', prompt: 'y', startedAt: 2 })
    await reg.complete(a.taskId, { status: 'done' })
    expect(reg.list({ wsId: 'w2' }).length).toBe(1)
    expect(reg.list({ status: 'done' }).map((t) => t.taskId)).toEqual([a.taskId])
    expect(reg.list({ limit: 1 }).length).toBe(1)
  })

  it('records issueId when an issue fired the run; omits it for manual runs', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const fired = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x', startedAt: 1, issueId: 'daily-scan' })
    const manual = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'y', startedAt: 2 })
    expect(fired.issueId).toBe('daily-scan')
    // Manual runs leave the field absent (not undefined-valued) so the JSON stays clean.
    expect('issueId' in manual).toBe(false)
    // Persists across reload.
    const reg2 = await HeadlessTaskRegistry.load(path, noopLogger)
    expect(reg2.get(fired.taskId)?.issueId).toBe('daily-scan')
  })

  it('list filters by issueId (the issue detail Activity feed join)', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const a = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x', startedAt: 1, issueId: 'iss-a' })
    const b = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'y', startedAt: 2, issueId: 'iss-a' })
    await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'z', startedAt: 3, issueId: 'iss-b' })
    await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'm', startedAt: 4 }) // manual, no issueId
    // newest-first, only iss-a's runs.
    expect(reg.list({ wsId: 'w1', issueId: 'iss-a' }).map((t) => t.taskId)).toEqual([b.taskId, a.taskId])
  })

  it('stores the full task prompt (not truncated — collapsible in the UI)', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const a = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x'.repeat(1000), startedAt: 1 })
    expect(a.prompt.length).toBe(1000)
  })

  it('persists completed records across reload', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const a = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x', startedAt: 1 })
    await reg.complete(a.taskId, { status: 'done', finishedAt: 2 })
    const reg2 = await HeadlessTaskRegistry.load(path, noopLogger)
    expect(reg2.get(a.taskId)?.status).toBe('done')
  })

  it('serializes concurrent registry writes without losing records', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const created = await Promise.all(
      Array.from({ length: 24 }, (_, index) => reg.create({
        wsId: `w${index % 3}`,
        agent: index % 2 ? 'pi' : 'codex',
        prompt: `task ${index}`,
        startedAt: index,
      })),
    )
    await Promise.all(created.map((task, index) => reg.complete(task.taskId, {
      status: 'done',
      output: { hasAssistantReply: true, assistantPreview: `reply ${index}`, blockCount: 2, toolCalls: 1, toolFailures: 0 },
    })))
    const reloaded = await HeadlessTaskRegistry.load(path, noopLogger)
    expect(reloaded.list()).toHaveLength(24)
    expect(reloaded.list().every((task) => task.status === 'done' && task.output?.toolCalls === 1)).toBe(true)
  })

  it('pages newest-first with a stable task cursor', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const oldest = await reg.create({ wsId: 'w1', agent: 'claude', prompt: 'oldest', startedAt: 1 })
    const middle = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'middle', startedAt: 2 })
    const newest = await reg.create({ wsId: 'w1', agent: 'pi', prompt: 'newest', startedAt: 3 })

    expect(reg.list({ limit: 2 }).map((task) => task.taskId)).toEqual([newest.taskId, middle.taskId])
    expect(reg.list({ cursor: middle.taskId, limit: 2 }).map((task) => task.taskId)).toEqual([oldest.taskId])
    expect(reg.list({ cursor: 'pruned-task', limit: 2 })).toEqual([])
    expect(reg.count({ wsId: 'w1' })).toBe(3)
    expect(reg.count({ status: 'running' })).toBe(3)
  })

  it('reconcile-on-boot flips a leftover running task → interrupted', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x', startedAt: 1 }) // stays running
    const reloaded = await HeadlessTaskRegistry.load(path, noopLogger)
    expect(reloaded.runningCount()).toBe(0)
    expect(reloaded.list()[0]?.status).toBe('interrupted')
  })

  it('setAgentSessionId records the id mid-run and persists across reload', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    const a = await reg.create({ wsId: 'w1', agent: 'claude', prompt: 'x', startedAt: 1 })
    await reg.setAgentSessionId(a.taskId, '414d6b8c-95b4-4e01-8ffc-4b6332da17d4')
    expect(reg.get(a.taskId)?.agentSessionId).toBe('414d6b8c-95b4-4e01-8ffc-4b6332da17d4')
    const reloaded = await HeadlessTaskRegistry.load(path, noopLogger)
    expect(reloaded.get(a.taskId)?.agentSessionId).toBe('414d6b8c-95b4-4e01-8ffc-4b6332da17d4')
  })

  it('pruning past MAX_RECORDS deletes the dropped tasks\' log files', async () => {
    const logsDir = join(dir, 'logs')
    await mkdir(logsDir, { recursive: true })
    const reg = await HeadlessTaskRegistry.load(path, noopLogger, { logsDir })
    const first = await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'old', startedAt: 1 })
    await reg.complete(first.taskId, { status: 'done' })
    const firstLogs = headlessLogPaths(logsDir, first.taskId)
    await writeFile(firstLogs.stdout, 'old stdout')
    await writeFile(firstLogs.stderr, 'old stderr')
    await writeFile(firstLogs.structured, '{}')
    // Fill past MAX_RECORDS (200) so `first` (oldest finished) gets pruned.
    for (let i = 0; i < 200; i++) {
      const t = await reg.create({ wsId: 'w1', agent: 'codex', prompt: `t${i}`, startedAt: 2 + i })
      await reg.complete(t.taskId, { status: 'done' })
    }
    expect(reg.get(first.taskId)).toBeNull()
    // rm is fire-and-forget; give the event loop a tick.
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(firstLogs.stdout)).toBe(false)
    expect(existsSync(firstLogs.stderr)).toBe(false)
    expect(existsSync(firstLogs.structured)).toBe(false)
  })
})
