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
})
