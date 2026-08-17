import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterRegistry } from './cli-adapter.js'
import type { Logger } from './logger.js'
import type { TemplateRegistry } from './template-registry.js'
import {
  WorkspaceCreator,
  inspectWorkspaceStorage,
} from './workspace-creator.js'
import type { WorkspaceRegistry } from './workspace-registry.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  )))
})

describe('Workspace creation storage failures', () => {
  it('rejects a volume below the creation safety margin', async () => {
    await expect(inspectWorkspaceStorage('/unused', {
      mkdirImpl: vi.fn(async () => undefined) as unknown as typeof mkdir,
      statfsImpl: vi.fn(async () => ({ bavail: 0, bsize: 4096 })) as unknown as typeof import('node:fs/promises').statfs,
    })).resolves.toEqual({ ok: false, availableBytes: 0 })
  })

  it('cleans a post-git-init ENOSPC bootstrap and never registers it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-enospc-create-'))
    temporaryPaths.push(root)
    const workspacesRoot = join(root, 'workspaces')
    const templateRoot = join(root, 'template')
    const bootstrapScript = join(templateRoot, 'bootstrap.mjs')
    await mkdir(templateRoot, { recursive: true })
    await writeFile(bootstrapScript, `
      import { mkdir, writeFile } from 'node:fs/promises'
      import { join } from 'node:path'
      const dir = process.argv[3]
      await mkdir(join(dir, '.git'), { recursive: true })
      await writeFile(join(dir, 'README.md'), '# partial\\n')
      process.stderr.write('Error: ENOSPC: no space left on device, write\\n')
      process.exitCode = 1
    `)

    const registry = {
      hasTag: vi.fn(() => false),
      hasId: vi.fn(() => false),
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    } as unknown as WorkspaceRegistry
    const log = testLogger()
    const creator = new WorkspaceCreator({
      workspacesRoot,
      templateRegistry: {
        get: () => ({
          name: 'fault',
          bootstrapScript,
          filesDir: templateRoot,
          templateDir: templateRoot,
          version: '1.0.0',
          defaultAgents: [],
          injectTools: false,
          injectInstructions: false,
          bundledSkills: [],
        }),
      } as unknown as TemplateRegistry,
      adapterRegistry: {
        list: () => [],
        get: () => undefined,
      } as unknown as AdapterRegistry,
      bootstrapEnv: { templateDir: '', launcherRepoRoot: root },
      bootstrapTimeoutMs: 10_000,
      registry,
      logger: log.logger,
    })

    await expect(creator.create('diskfull', 'fault')).resolves.toMatchObject({
      ok: false,
      code: 'insufficient_storage',
      message: expect.stringContaining('Free disk space'),
    })
    expect(await readdir(workspacesRoot)).toEqual([])
    expect(registry.add).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith('bootstrap.failed', expect.objectContaining({ exitCode: 1 }))
  })
})

function testLogger() {
  const info = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()
  const logger = {
    info,
    warn,
    error,
    debug: vi.fn(),
    child: () => logger,
  } as unknown as Logger
  return { logger, info, warn, error }
}
