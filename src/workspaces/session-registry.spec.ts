import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SessionRegistry, type SessionRecord } from './session-registry.js'
import type { Logger } from './logger.js'

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  event() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// Petname wsId so bootFixup proves it scans the new human-readable file shape.
const WS = 'chat-calm-amber-river'
const LEGACY_UUID_WS = '4894ef8b-66e1-4a41-a222-ba564e51a8c0'

function rec(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'claude-calm-amber-river',
    wsId: WS,
    agent: 'claude',
    name: 'c1',
    createdAt: '2026-06-16T00:00:00.000Z',
    lastActiveAt: '2026-06-16T00:00:00.000Z',
    state: 'running',
    ...over,
  }
}

describe('SessionRegistry persistence', () => {
  // Regression: parseRecords rebuilt each record field-by-field and dropped
  // `title`, so the chat-sidebar title reverted to the `c1` name on every
  // server restart / registry reload even though flush had written it to disk.
  it('round-trips the session title across a reload', async () => {
    const reg = await SessionRegistry.load(root, noopLogger)
    await reg.create(rec({
      id: 'claude-calm-amber-river',
      title: "What's moving in semiconductors today?",
    }))
    await reg.create(rec({
      id: 'claude-clear-copper-harbor',
      name: 'c2',
      title: '解释一下美债收益率曲线倒挂',
    }))
    await reg.create(rec({ id: 'claude-quiet-silver-meadow', name: 'c3' })) // unseeded — no title

    // A fresh instance over the same dir = a server restart.
    const reloaded = await SessionRegistry.load(root, noopLogger)
    await reloaded.ensureLoaded(WS)
    const byId = new Map(reloaded.listFor(WS).map((r) => [r.id, r]))

    expect(byId.get('claude-calm-amber-river')?.title).toBe(
      "What's moving in semiconductors today?",
    )
    expect(byId.get('claude-clear-copper-harbor')?.title).toBe(
      '解释一下美债收益率曲线倒挂',
    ) // CJK survives
    expect(byId.get('claude-quiet-silver-meadow')?.title).toBeUndefined() // unseeded stays nameless
  })

  // The exact path the user hit: a reload both flips orphaned running→paused
  // (bootFixup) AND must keep the title — they share the load codepath.
  it('keeps the title when bootFixup flips an orphaned running session to paused', async () => {
    const reg = await SessionRegistry.load(root, noopLogger)
    await reg.create(rec({
      id: 'claude-calm-amber-river',
      state: 'running',
      title: 'Build a thesis on NVDA',
    }))

    const reloaded = await SessionRegistry.load(root, noopLogger)
    await reloaded.ensureLoaded(WS)
    const r = reloaded.listFor(WS)[0]

    expect(r?.state).toBe('paused') // orphaned running flipped on reload
    expect(r?.title).toBe('Build a thesis on NVDA') // …and the title is intact
  })

  it('keeps loading legacy UUID workspace files without a migration', async () => {
    const reg = await SessionRegistry.load(root, noopLogger)
    await reg.create(rec({
      id: 'claude-clear-copper-harbor',
      wsId: LEGACY_UUID_WS,
      state: 'paused',
      title: 'Legacy workspace still opens',
    }))

    const reloaded = await SessionRegistry.load(root, noopLogger)
    await reloaded.ensureLoaded(LEGACY_UUID_WS)

    expect(reloaded.get(LEGACY_UUID_WS, 'claude-clear-copper-harbor')?.title).toBe(
      'Legacy workspace still opens',
    )
  })
})
