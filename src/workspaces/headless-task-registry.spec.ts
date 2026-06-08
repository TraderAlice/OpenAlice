import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HeadlessTaskRegistry } from './headless-task-registry.js'
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

  it('reconcile-on-boot flips a leftover running task → interrupted', async () => {
    const reg = await HeadlessTaskRegistry.load(path, noopLogger)
    await reg.create({ wsId: 'w1', agent: 'codex', prompt: 'x', startedAt: 1 }) // stays running
    const reloaded = await HeadlessTaskRegistry.load(path, noopLogger)
    expect(reloaded.runningCount()).toBe(0)
    expect(reloaded.list()[0]?.status).toBe('interrupted')
  })
})
