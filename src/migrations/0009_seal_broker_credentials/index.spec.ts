import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { MigrationContext } from '../types.js'

let home: string
let configDir: string
let savedHome: string | undefined

/** Migration + sealing both resolve userDataHome at module load. */
async function loadMigration() {
  vi.resetModules()
  process.env['OPENALICE_HOME'] = home
  const { migration } = await import('./index.js')
  const sealing = await import('@/core/sealing.js')
  return { migration, sealing }
}

function makeCtx(): MigrationContext {
  return {
    readJson: async <T = unknown>(filename: string): Promise<T | undefined> => {
      try {
        return JSON.parse(await readFile(resolve(configDir, filename), 'utf-8')) as T
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw err
      }
    },
    writeJson: async (filename: string, data: unknown) => {
      await writeFile(resolve(configDir, filename), JSON.stringify(data, null, 2) + '\n')
    },
    removeJson: async (filename: string) => {
      await rm(resolve(configDir, filename), { force: true })
    },
    configDir: () => configDir,
  }
}

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(join(tmpdir(), 'oa-mig0009-'))
  configDir = join(home, 'data', 'config')
  await mkdir(configDir, { recursive: true })
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

describe('0009_seal_broker_credentials', () => {
  const accounts = [{ id: 'okx-1', presetId: 'okx', presetConfig: { apiKey: 'k', secret: 'sup3r' } }]

  it('seals a plaintext array in place', async () => {
    const { migration, sealing } = await loadMigration()
    await writeFile(join(configDir, 'accounts.json'), JSON.stringify(accounts, null, 2))

    await migration.up(makeCtx())

    const onDisk = JSON.parse(await readFile(join(configDir, 'accounts.json'), 'utf-8'))
    expect(sealing.isSealedEnvelope(onDisk)).toBe(true)
    expect(JSON.stringify(onDisk)).not.toContain('sup3r')
    await expect(sealing.unseal(onDisk)).resolves.toEqual(accounts)
  })

  it('is idempotent — a sealed file is left byte-for-byte unchanged', async () => {
    const { migration } = await loadMigration()
    await writeFile(join(configDir, 'accounts.json'), JSON.stringify(accounts, null, 2))
    await migration.up(makeCtx())
    const afterFirst = await readFile(join(configDir, 'accounts.json'), 'utf-8')

    await migration.up(makeCtx())
    expect(await readFile(join(configDir, 'accounts.json'), 'utf-8')).toBe(afterFirst)
  })

  it('no-ops when the file is missing', async () => {
    const { migration } = await loadMigration()
    await expect(migration.up(makeCtx())).resolves.toBeUndefined()
  })

  it('leaves unrecognized content untouched for a human', async () => {
    const { migration } = await loadMigration()
    const weird = JSON.stringify({ not: 'an array' }, null, 2)
    await writeFile(join(configDir, 'accounts.json'), weird)
    await migration.up(makeCtx())
    expect(await readFile(join(configDir, 'accounts.json'), 'utf-8')).toBe(weird)
  })
})
