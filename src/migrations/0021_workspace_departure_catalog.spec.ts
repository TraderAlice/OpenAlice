import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateWorkspaceDepartureCatalog } from './0021_workspace_departure_catalog/index.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-departure-migration-'))
  await mkdir(join(root, 'workspaces', 'chat-active'), { recursive: true })
  await mkdir(join(root, 'workspaces', 'chat-orphan'), { recursive: true })
  await mkdir(join(root, 'state'), { recursive: true })
  await writeFile(join(root, 'workspaces.json'), JSON.stringify({
    version: 1,
    workspaces: [{
      id: 'chat-active',
      tag: 'active',
      dir: join(root, 'workspaces', 'chat-active'),
      createdAt: '2026-01-01T00:00:00.000Z',
      agents: ['pi'],
      template: 'chat',
    }],
  }))
  await writeFile(join(root, 'state', 'chat-orphan.json'), JSON.stringify({
    version: 2,
    records: [{ agent: 'codex' }],
  }))
})

afterEach(async () => rm(root, { recursive: true, force: true }))

describe('0021 Workspace departure catalog', () => {
  it('moves only unregistered directories and keeps a restorable tombstone', async () => {
    expect(await migrateWorkspaceDepartureCatalog(root)).toEqual({
      active: 1,
      departed: 1,
      moved: 1,
      conflicts: 0,
    })
    expect(existsSync(join(root, 'workspaces', 'chat-active'))).toBe(true)
    expect(existsSync(join(root, 'workspaces', 'chat-orphan'))).toBe(false)
    expect(existsSync(join(root, 'departed-workspaces', 'chat-orphan'))).toBe(true)

    const catalog = JSON.parse(await readFile(join(root, 'state', 'workspace-catalog.json'), 'utf8'))
    expect(catalog.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chat-active', lifecycle: 'active', tag: 'active' }),
      expect.objectContaining({
        id: 'chat-orphan',
        lifecycle: 'departed',
        legacyImported: true,
        agents: ['codex'],
        template: 'chat',
      }),
    ]))

    expect(await migrateWorkspaceDepartureCatalog(root)).toMatchObject({ moved: 0, conflicts: 0 })
  })

  it('refuses an unreadable registry without moving any directory', async () => {
    await writeFile(join(root, 'workspaces.json'), '{broken')
    await expect(migrateWorkspaceDepartureCatalog(root)).rejects.toThrow(/not valid JSON/)
    expect(existsSync(join(root, 'workspaces', 'chat-active'))).toBe(true)
    expect(existsSync(join(root, 'workspaces', 'chat-orphan'))).toBe(true)
  })

  it('preflights identity collisions before moving any orphan', async () => {
    await mkdir(join(root, 'departed-workspaces', 'chat-orphan'), { recursive: true })
    await mkdir(join(root, 'workspaces', 'chat-second-orphan'), { recursive: true })

    await expect(migrateWorkspaceDepartureCatalog(root)).rejects.toThrow(/identity conflicts/)

    expect(existsSync(join(root, 'workspaces', 'chat-orphan'))).toBe(true)
    expect(existsSync(join(root, 'workspaces', 'chat-second-orphan'))).toBe(true)
    expect(existsSync(join(root, 'departed-workspaces', 'chat-orphan'))).toBe(true)
    expect(existsSync(join(root, 'departed-workspaces', 'chat-second-orphan'))).toBe(false)
  })
})
