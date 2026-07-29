import { describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../types.js'
import { migration, repairSnapshotInterval } from './index.js'

function context(initial: unknown) {
  let value = initial
  const writeJson = vi.fn(async (_filename: string, next: unknown) => {
    value = next
  })
  const ctx: MigrationContext = {
    async readJson<T>(): Promise<T | undefined> {
      return value as T | undefined
    },
    writeJson,
    removeJson: vi.fn(async () => {}),
    configDir: () => '/tmp/openalice-migration-test',
  }
  return { ctx, writeJson, value: () => value }
}

describe('0027 repair snapshot interval', () => {
  it('replaces an invalid historical interval and is idempotent', async () => {
    const state = context({ enabled: false, every: 'nonsense' })

    await migration.up(state.ctx)
    await migration.up(state.ctx)

    expect(state.value()).toEqual({ enabled: false, every: '15m' })
    expect(state.writeJson).toHaveBeenCalledOnce()
    expect(state.writeJson).toHaveBeenCalledWith('snapshot.json', {
      enabled: false,
      every: '15m',
    })
  })

  it('normalizes valid whitespace without changing other settings', () => {
    expect(repairSnapshotInterval({
      enabled: true,
      every: ' 2h15m ',
      futureSetting: true,
    })).toEqual({
      value: {
        enabled: true,
        every: '2h15m',
        futureSetting: true,
      },
      updated: true,
    })
  })

  it('leaves missing and already-valid intervals untouched', () => {
    const current = { enabled: true, every: '30m' }
    expect(repairSnapshotInterval(current)).toEqual({ value: current, updated: false })
    expect(repairSnapshotInterval({ enabled: false })).toEqual({
      value: { enabled: false },
      updated: false,
    })
    expect(repairSnapshotInterval(undefined)).toEqual({ value: undefined, updated: false })
  })
})
