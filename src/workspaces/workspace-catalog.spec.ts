import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Logger } from './logger.js'
import { WorkspaceCatalog } from './workspace-catalog.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('WorkspaceCatalog legacy adapter metadata', () => {
  it('drops unknown agents fields while loading and never flushes them again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-catalog-agents-'))
    temporaryPaths.push(root)
    const path = join(root, 'workspace-catalog.json')
    await writeFile(path, JSON.stringify({
      version: 1,
      workspaces: [{
        id: 'chat-old',
        tag: 'chat-old',
        activeDir: join(root, 'chat-old'),
        createdAt: '2026-07-01T00:00:00.000Z',
        lifecycle: 'active',
        updatedAt: '2026-07-01T00:00:00.000Z',
        agents: ['claude'],
      }],
    }))

    const catalog = await WorkspaceCatalog.load(path, [], logger())
    expect(catalog.get('chat-old')).not.toHaveProperty('agents')

    await catalog.recordCreated({
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
