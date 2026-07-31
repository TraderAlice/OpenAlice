import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateSessionNativeTitles } from './0029_session_native_titles/index.js'

let root: string
let launcherRoot: string
let backupRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'session-title-migration-'))
  launcherRoot = join(root, 'workspaces')
  backupRoot = join(root, 'backup')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0029 native Session titles', () => {
  it('moves legacy titles to fallbackTitle and backs up the original file', async () => {
    const dir = join(launcherRoot, 'state', 'sessions')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'chat-calm-amber-river.json')
    const original = {
      version: 2,
      records: [
        {
          id: 'codex-calm-amber-river',
          name: 'x1',
          title: 'The first user message',
          state: 'paused',
        },
        {
          id: 'claude-clear-copper-harbor',
          name: 'c1',
          state: 'paused',
        },
      ],
    }
    await writeFile(path, JSON.stringify(original))

    await expect(migrateSessionNativeTitles(launcherRoot, { backupRoot }))
      .resolves.toEqual({ updated: 1 })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 3,
      records: [
        {
          id: 'codex-calm-amber-river',
          name: 'x1',
          fallbackTitle: 'The first user message',
          state: 'paused',
        },
        {
          id: 'claude-clear-copper-harbor',
          name: 'c1',
          state: 'paused',
        },
      ],
    })
    expect(JSON.parse(await readFile(join(backupRoot, 'chat-calm-amber-river.json'), 'utf8')))
      .toEqual(original)
  })

  it('is idempotent and leaves malformed or future files untouched', async () => {
    const dir = join(launcherRoot, 'state', 'sessions')
    await mkdir(dir, { recursive: true })
    const current = join(dir, 'chat-ready.json')
    const malformed = join(dir, 'chat-broken.json')
    await writeFile(current, JSON.stringify({
      version: 3,
      records: [{ title: 'Native title', fallbackTitle: 'First message' }],
    }))
    await writeFile(malformed, '{broken')

    await expect(migrateSessionNativeTitles(launcherRoot, { backupRoot }))
      .resolves.toEqual({ updated: 0 })
    expect(JSON.parse(await readFile(current, 'utf8'))).toEqual({
      version: 3,
      records: [{ title: 'Native title', fallbackTitle: 'First message' }],
    })
    expect(await readFile(malformed, 'utf8')).toBe('{broken')
  })
})
