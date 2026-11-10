import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Logger } from '../logger.js'
import { ScheduleMarkerStore } from './marker-store.js'

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  event() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sched-markers-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ScheduleMarkerStore', () => {
  it('reads version-1 numeric markers as last-fired only', async () => {
    const path = join(dir, 'markers.json')
    await writeFile(path, JSON.stringify({ version: 1, markers: { 'ws task': 123 } }), 'utf8')
    const store = await ScheduleMarkerStore.load(path, noopLogger)
    expect(store.get('ws', 'task')).toBe(123)
    expect(store.getHeld('ws', 'task')).toBeUndefined()
  })

  it('persists a held cursor beside last-fired and clears it on the next success', async () => {
    const path = join(dir, 'markers.json')
    const store = await ScheduleMarkerStore.load(path, noopLogger)
    await store.hold('ws', 'task', 50)
    expect(store.getHeld('ws', 'task')).toBe(50)
    expect(store.get('ws', 'task')).toBeUndefined()

    await store.set('ws', 'task', 80)
    expect(store.get('ws', 'task')).toBe(80)
    expect(store.getHeld('ws', 'task')).toBeUndefined()

    const saved = JSON.parse(await readFile(path, 'utf8')) as { version: number; markers: Record<string, unknown> }
    expect(saved.version).toBe(2)
    expect(saved.markers['ws task']).toEqual({ fired: 80 })
  })

  it('persists 20 concurrent set/hold calls cleanly without tmp-file races', async () => {
    const path = join(dir, 'markers.json')
    const warns: unknown[] = []
    const logger = { ...noopLogger, warn: (_: string, meta: unknown) => warns.push(meta) } as unknown as Logger
    const store = await ScheduleMarkerStore.load(path, logger)
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0 ? store.set('ws', `task-${i}`, 100 + i) : store.hold('ws', `task-${i}`, 200 + i),
      ),
    )
    expect(warns).toEqual([])
    const saved = JSON.parse(await readFile(path, 'utf8')) as { version: number; markers: Record<string, { fired?: number; held?: number }> }
    expect(Object.keys(saved.markers)).toHaveLength(20)
    for (let i = 0; i < 20; i++) {
      const record = saved.markers[`ws task-${i}`]
      expect(record).toBeDefined()
      if (i % 2 === 0) expect(record!.fired).toBe(100 + i)
      else expect(record!.held).toBe(200 + i)
    }
  })
})
