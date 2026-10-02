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
    appVersion: '0.89.2-beta',
    introducedAt: '2026-01-01',
    affects: ['*'],
    summary: `test migration ${id}`,
    up: body ?? (async () => { /* no-op */ }),
  }
}

describe('runMigrations', () => {
  it.each([
    ['old journal', '0.70.0-beta.4', ['0010_workspace_issues_to_markdown']],
    ['partially migrated journal', '0.94.1', ['0010_workspace_issues_to_markdown', '0039_workspace_session_runtime_bindings', '0040_unified_session_records', '0041_connector_desk_flag', '0042_workspace_default_agent', '0043_inbox_markdown_body']],
    ['old version without entries', '0.70.0-beta.4', []],
  ])('rejects %s before snapshots or writes', async (_name, appVersion, ids) => {
    const { ctx, files } = makeMemoryContext({
      '_meta.json': { appVersion, appliedMigrations: (ids as string[]).map(id => ({ id, appliedAt: 'x', appVersion })) },
      'engine.json': { preserved: true },
    })
    const before = JSON.stringify([...files])
    const snapshot = vi.fn(async () => null)
    const up = vi.fn(async () => {})
    await expect(runMigrations({ ctx, registry: [makeMigration('0044_test', up)], snapshot }))
      .rejects.toThrow('predates the supported 0.89.2-beta migration baseline')
    expect(snapshot).not.toHaveBeenCalled()
    expect(up).not.toHaveBeenCalled()
    expect(JSON.stringify([...files])).toBe(before)
    // Even an otherwise fully-applied active chain must not hide the old home.
    await expect(runMigrations({ ctx, registry: [], snapshot })).rejects.toThrow('Do not delete or edit')
  })

  it('accepts a home that completed the retired chain', async () => {
    const { ctx } = makeMemoryContext({
      '_meta.json': { appVersion: '0.89.2-beta', appliedMigrations: [
        { id: '0010_workspace_issues_to_markdown', appliedAt: 'x', appVersion: '0.70.0-beta.4' },
        { id: '0038_workspace_runtime_modes', appliedAt: 'x', appVersion: '0.89.2-beta' },
      ] },
    })
    const up = vi.fn(async () => {})
    await runMigrations({ ctx, registry: [makeMigration('0039_test', up)], snapshot: async () => null })
    expect(up).toHaveBeenCalledOnce()
  })

  it('applies all migrations on empty journal', async () => {
    const { ctx, files } = makeMemoryContext()
    const calls: string[] = []
    const registry = [
      makeMigration('0039_a', async () => { calls.push('a') }),
      makeMigration('0040_b', async () => { calls.push('b') }),
    ]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    expect(calls).toEqual(['a', 'b'])
    const meta = readMeta(files)!
    expect(meta.appliedMigrations.map(m => m.id)).toEqual(['0039_a', '0040_b'])
  })

  it('skips migrations already in journal', async () => {
    const { ctx, files } = makeMemoryContext({
      '_meta.json': {
        appVersion: '0.89.2-beta',
        appliedMigrations: [{ id: '0039_a', appliedAt: 'x', appVersion: '0.89.2-beta' }],
      },
    })
    const calls: string[] = []
    const registry = [
      makeMigration('0039_a', async () => { calls.push('a') }),
      makeMigration('0040_b', async () => { calls.push('b') }),
    ]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    expect(calls).toEqual(['b']) // 0039_a skipped
    const meta = readMeta(files)!
    expect(meta.appliedMigrations.map(m => m.id)).toEqual(['0039_a', '0040_b'])
  })

  it('halts on failure; journal is NOT updated for the failed migration', async () => {
    const { ctx, files } = makeMemoryContext()
    const registry = [
      makeMigration('0039_a'),
      makeMigration('0040_b', async () => { throw new Error('boom') }),
      makeMigration('0041_c'),
    ]

    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(runMigrations({ ctx, registry, snapshot: async () => null }))
      .rejects.toThrow('boom')

    const meta = readMeta(files)!
    expect(meta.appliedMigrations.map(m => m.id)).toEqual(['0039_a']) // 0002 NOT recorded
    consoleErrSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('idempotent: second run is a no-op when nothing pending', async () => {
    const { ctx, files } = makeMemoryContext()
    const calls: string[] = []
    const registry = [makeMigration('0039_a', async () => { calls.push('a') })]

    await runMigrations({ ctx, registry, snapshot: async () => null })
    await runMigrations({ ctx, registry, snapshot: async () => null })

    expect(calls).toEqual(['a']) // body ran exactly once
    const meta = readMeta(files)!
    expect(meta.appliedMigrations).toHaveLength(1)
  })

  it('seeds empty meta when _meta.json missing', async () => {
    const { ctx, files } = makeMemoryContext()
    const registry = [makeMigration('0039_a')]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    const meta = readMeta(files)!
    expect(meta.appliedMigrations).toHaveLength(1)
    expect(meta.appVersion).toBeDefined()
  })

  it('calls snapshot for each pending migration with pre-{id} label', async () => {
    const { ctx } = makeMemoryContext()
    const labels: string[] = []
    const registry = [
      makeMigration('0039_a'),
      makeMigration('0040_b'),
    ]

    await runMigrations({
      ctx,
      registry,
      snapshot: async (label) => { labels.push(label); return null },
    })

    expect(labels).toEqual(['pre-0039_a', 'pre-0040_b'])
  })

  it('writes appliedAt as ISO timestamp and appVersion on each entry', async () => {
    const { ctx, files } = makeMemoryContext()
    const registry = [makeMigration('0039_a')]

    await runMigrations({ ctx, registry, snapshot: async () => null })

    const meta = readMeta(files)!
    const entry = meta.appliedMigrations[0]
    expect(entry.id).toBe('0039_a')
    expect(entry.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entry.appVersion).toBeDefined()
  })
})
