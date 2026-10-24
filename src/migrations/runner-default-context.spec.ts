/**
 * `makeDefaultContext()` is the migration runner's only real-disk reader, and
 * `runMigrations()` executes before the config loader — so a file it cannot
 * parse stops boot before any friendlier error path exists. These tests point
 * OPENALICE_HOME (captured by paths.ts at module load) at a scratch home and
 * re-import the runner, which is the idiom the config disk specs use.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Migration } from './types.js'

let home: string
let configDir: string
let savedHome: string | undefined

async function loadRunner(): Promise<typeof import('./runner.js')> {
  vi.resetModules()
  process.env['OPENALICE_HOME'] = home
  return import('./runner.js')
}

function migration(id: string, calls: string[]): Migration {
  return {
    id,
    appVersion: '0.0.0',
    introducedAt: '2026-01-01',
    affects: ['*'],
    summary: `test migration ${id}`,
    up: async () => { calls.push(id) },
  }
}

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(join(tmpdir(), 'oa-migration-ctx-'))
  configDir = join(home, 'data', 'config')
  await mkdir(configDir, { recursive: true })
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

describe('makeDefaultContext().readJson', () => {
  it('returns undefined for a missing file', async () => {
    const { makeDefaultContext } = await loadRunner()
    await expect(makeDefaultContext().readJson('agent.json')).resolves.toBeUndefined()
  })

  it('reads a file saved with a UTF-8 BOM by PowerShell or Notepad', async () => {
    await writeFile(join(configDir, 'agent.json'), '\uFEFF{ "maxSteps": 5 }')
    const { makeDefaultContext } = await loadRunner()
    await expect(makeDefaultContext().readJson<{ maxSteps: number }>('agent.json'))
      .resolves.toEqual({ maxSteps: 5 })
  })

  it('names the file when a migration input is not valid JSON', async () => {
    await writeFile(join(configDir, '_meta.json'), '{ not json')
    const { makeDefaultContext } = await loadRunner()
    await expect(makeDefaultContext().readJson('_meta.json'))
      .rejects.toThrow(/Invalid JSON in .*_meta\.json/)
  })
})

describe('runMigrations with the default context', () => {
  it('applies pending migrations when _meta.json carries a BOM', async () => {
    await writeFile(join(configDir, '_meta.json'), '\uFEFF{ "appVersion": "0.0.0", "appliedMigrations": [] }')
    const { runMigrations } = await loadRunner()
    const calls: string[] = []
    await runMigrations({ registry: [migration('0001_a', calls)], snapshot: async () => null })
    expect(calls).toEqual(['0001_a'])
  })
})
