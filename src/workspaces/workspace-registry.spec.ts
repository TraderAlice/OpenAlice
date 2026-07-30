import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Logger } from './logger.js'
import { WorkspaceRegistry } from './workspace-registry.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('WorkspaceRegistry persistence failures', () => {
  it('rolls back the in-memory row when the registry file cannot be persisted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-registry-failure-'))
    temporaryPaths.push(root)
    const registry = await WorkspaceRegistry.load(join(root, 'workspaces.json'), logger())
    const error = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    vi.spyOn(registry as unknown as { flush(): Promise<void> }, 'flush').mockRejectedValueOnce(error)

    await expect(registry.add({
      id: 'chat-failed-row',
      tag: 'diskfull',
      dir: join(root, 'chat-failed-row'),
      createdAt: '2026-07-15T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'ENOSPC' })

    expect(registry.hasId('chat-failed-row')).toBe(false)
    expect(registry.hasTag('diskfull')).toBe(false)
    expect(registry.list()).toEqual([])
  })
})

describe('WorkspaceRegistry legacy adapter metadata', () => {
  it('ignores legacy agents and never persists them again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-registry-agents-'))
    temporaryPaths.push(root)
    const path = join(root, 'workspaces.json')
    await writeFile(path, JSON.stringify({
      version: 1,
      workspaces: [{
        id: 'chat-old',
        tag: 'chat-old',
        dir: join(root, 'chat-old'),
        createdAt: '2026-07-01T00:00:00.000Z',
        agents: ['claude'],
      }],
    }))

    const registry = await WorkspaceRegistry.load(path, logger())
    expect(registry.get('chat-old')).toEqual({
      id: 'chat-old',
      tag: 'chat-old',
      dir: join(root, 'chat-old'),
      createdAt: '2026-07-01T00:00:00.000Z',
    })

    await registry.add({
      id: 'chat-new',
      tag: 'chat-new',
      dir: join(root, 'chat-new'),
      createdAt: '2026-07-31T00:00:00.000Z',
    })
    expect(await readFile(path, 'utf8')).not.toContain('"agents"')
  })
})

function logger(): Logger {
  const value = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => value,
  }
  return value as unknown as Logger
}
