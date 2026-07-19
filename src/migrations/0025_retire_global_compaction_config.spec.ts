import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MigrationContext } from './types.js'
import {
  migration,
  retireGlobalContextDefault,
} from './0025_retire_global_compaction_config/index.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'retire-compaction-migration-'))
})

afterEach(async () => rm(root, { recursive: true, force: true }))

function context(): MigrationContext {
  return {
    async readJson<T>(filename: string): Promise<T | undefined> {
      try {
        return JSON.parse(await readFile(join(root, filename), 'utf8')) as T
      } catch (error) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async writeJson(filename: string, data: unknown): Promise<void> {
      await mkdir(root, { recursive: true })
      await writeFile(join(root, filename), `${JSON.stringify(data, null, 2)}\n`)
    },
    async removeJson(filename: string): Promise<void> {
      await unlink(join(root, filename)).catch((error: unknown) => {
        if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    },
    configDir: () => root,
  }
}

describe('0025 retire global compaction config', () => {
  it('removes legacy limits and remains idempotent when the file is absent', async () => {
    const ctx = context()
    await ctx.writeJson('compaction.json', {
      maxContextTokens: 200_000,
      maxOutputTokens: 20_000,
      autoCompactBuffer: 13_000,
      microcompactKeepRecent: 3,
    })
    await ctx.writeJson('ai-provider-manager.json', {
      credentials: { custom: { vendor: 'custom' } },
      workspaceDefaultContextWindow: 256_000,
    })

    await migration.up(ctx)
    await expect(ctx.readJson('compaction.json')).resolves.toBeUndefined()
    await expect(ctx.readJson('ai-provider-manager.json')).resolves.toEqual({
      credentials: { custom: { vendor: 'custom' } },
    })
    await expect(migration.up(ctx)).resolves.toBeUndefined()
  })

  it('preserves malformed or already-migrated provider state', () => {
    expect(retireGlobalContextDefault(null)).toEqual({ value: null, updated: false })
    const current = { credentials: {} }
    expect(retireGlobalContextDefault(current)).toEqual({ value: current, updated: false })
  })
})
