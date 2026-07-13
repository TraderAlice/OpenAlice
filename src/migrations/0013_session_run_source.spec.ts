import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateSessionRunSource } from './0013_session_run_source/index.js'

let root: string
let launcherRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mig0013-'))
  launcherRoot = join(root, 'workspaces')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0013 session run source', () => {
  it('upgrades v1 files without changing their records', async () => {
    const dir = join(launcherRoot, 'state', 'sessions')
    await mkdir(dir, { recursive: true })
    const records = [{
      id: 'codex-calm-amber-river',
      wsId: 'chat-calm-amber-river',
      agent: 'codex',
      name: 'x1',
      createdAt: '2026-07-01T00:00:00.000Z',
      lastActiveAt: '2026-07-01T00:00:00.000Z',
      state: 'paused',
    }]
    const path = join(dir, 'chat-calm-amber-river.json')
    await writeFile(path, JSON.stringify({ version: 1, records }), 'utf-8')

    expect(await migrateSessionRunSource(launcherRoot)).toEqual({ updated: 1 })
    expect(JSON.parse(await readFile(path, 'utf-8'))).toEqual({ version: 2, records })
  })

  it('is idempotent and leaves malformed files untouched', async () => {
    const dir = join(launcherRoot, 'state', 'sessions')
    await mkdir(dir, { recursive: true })
    const v2 = join(dir, 'chat-ready.json')
    const malformed = join(dir, 'chat-broken.json')
    await writeFile(v2, JSON.stringify({ version: 2, records: [] }), 'utf-8')
    await writeFile(malformed, '{broken', 'utf-8')

    expect(await migrateSessionRunSource(launcherRoot)).toEqual({ updated: 0 })
    expect(await readFile(v2, 'utf-8')).toBe(JSON.stringify({ version: 2, records: [] }))
    expect(await readFile(malformed, 'utf-8')).toBe('{broken')
  })
})
