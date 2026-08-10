import { describe, it, expect, vi } from 'vitest'
import type { Migration, MigrationContext, ConfigMeta } from './types.js'
import { runMigrations } from './runner.js'

/** Create an in-memory MigrationContext over a virtual config dir. */
function makeMemoryContext(initial: Record<string, unknown> = {}): {
  ctx: MigrationContext
  files: Map<string, unknown>
} {
  const files = new Map<string, unknown>(Object.entries(initial))
  const ctx: MigrationContext = {
    async readJson<T>(filename: string): Promise<T | undefined> {
      // Round-trip through JSON to mimic real disk semantics
      const v = files.get(filename)
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
    },
    async writeJson(filename: string, data: unknown): Promise<void> {
      files.set(filename, JSON.parse(JSON.stringify(data)))
    },
    async removeJson(filename: string): Promise<void> {
      files.delete(filename)
    },
    configDir(): string {
      return '/virtual/config'
    },
    userDataHome(): string {
      return '/virtual'
    },
    launcherRoot(): string {
      return '/virtual/workspaces'
    },
  }
  return { ctx, files }
}

function readMeta(files: Map<string, unknown>): ConfigMeta | undefined {
  return files.get('_meta.json') as ConfigMeta | undefined
}

function makeMigration(id: string, body?: (ctx: MigrationContext) => Promise<void>): Migration {
  return {
    id,
    appVersion: '0.0.0',
    introducedAt: '2026-01-01',
    affects: ['*'],
    summary: `test migration ${id}`,
    up: body ?? (async () => { /* no-op */ }),
  }
}

describe('runMigrations', () => {
  it('applies all migrations on empty journal', async () => {
    const { ctx, files } = makeMemoryContext()
    const calls: string[] = []
    const registry = [
      makeMigration('0001_a', async () => { calls.push('a') }),
      makeMigration('0002_b', async () => { calls.push('b') }),
    ]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    expect(calls).toEqual(['a', 'b'])
    const meta = readMeta(files)!
    expect(meta.appliedMigrations.map(m => m.id)).toEqual(['0001_a', '0002_b'])
  })

  it('skips migrations already in journal', async () => {
    const { ctx, files } = makeMemoryContext({
      '_meta.json': {
        appVersion: '0.0.0',
        appliedMigrations: [{ id: '0001_a', appliedAt: 'x', appVersion: '0.0.0' }],
      },
    })
    const calls: string[] = []
    const registry = [
      makeMigration('0001_a', async () => { calls.push('a') }),
      makeMigration('0002_b', async () => { calls.push('b') }),
    ]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    expect(calls).toEqual(['b']) // 0001_a skipped
    const meta = readMeta(files)!
    expect(meta.appliedMigrations.map(m => m.id)).toEqual(['0001_a', '0002_b'])
  })

  it('halts on failure; journal is NOT updated for the failed migration', async () => {
    const { ctx, files } = makeMemoryContext()
    const registry = [
      makeMigration('0001_a'),
      makeMigration('0002_b', async () => { throw new Error('boom') }),
      makeMigration('0003_c'),
    ]

    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(runMigrations({ ctx, registry, snapshot: async () => null }))
      .rejects.toThrow('boom')

    const meta = readMeta(files)!
    expect(meta.appliedMigrations.map(m => m.id)).toEqual(['0001_a']) // 0002 NOT recorded
    consoleErrSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('idempotent: second run is a no-op when nothing pending', async () => {
    const { ctx, files } = makeMemoryContext()
    const calls: string[] = []
    const registry = [makeMigration('0001_a', async () => { calls.push('a') })]

    await runMigrations({ ctx, registry, snapshot: async () => null })
    await runMigrations({ ctx, registry, snapshot: async () => null })

    expect(calls).toEqual(['a']) // body ran exactly once
    const meta = readMeta(files)!
    expect(meta.appliedMigrations).toHaveLength(1)
  })

  it('seeds empty meta when _meta.json missing', async () => {
    const { ctx, files } = makeMemoryContext()
    const registry = [makeMigration('0001_a')]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    const meta = readMeta(files)!
    expect(meta.appliedMigrations).toHaveLength(1)
    expect(meta.appVersion).toBeDefined()
  })

  it('calls snapshot for each pending migration with pre-{id} label', async () => {
    const { ctx } = makeMemoryContext()
    const labels: string[] = []
    const registry = [
      makeMigration('0001_a'),
      makeMigration('0002_b'),
    ]

    await runMigrations({
      ctx,
      registry,
      snapshot: async (label) => { labels.push(label); return null },
    })

    expect(labels).toEqual(['pre-0001_a', 'pre-0002_b'])
  })

  it('writes appliedAt as ISO timestamp and appVersion on each entry', async () => {
    const { ctx, files } = makeMemoryContext()
    const registry = [makeMigration('0001_a')]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    const meta = readMeta(files)!
    const entry = meta.appliedMigrations[0]
    expect(entry.id).toBe('0001_a')
    expect(entry.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entry.appVersion).toBeDefined()
  })
})
