import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { migrateWorkspaceRuntimeSettingsV2 } from './0037_workspace_runtime_settings_v2/index.js'

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'workspace-runtime-settings-v2-'))
}

async function writeSettings(root: string, kind: 'workspaces' | 'departed-workspaces', name: string, value: unknown) {
  const dir = join(root, kind, name, '.alice')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'settings.json'), `${JSON.stringify(value, null, 2)}\n`)
}

describe('0037 Workspace runtime settings v2 migration', () => {
  it('moves legacy interactive/headless choices into recent scenario fallbacks', async () => {
    const root = await fixture()
    const backupRoot = join(root, 'backups')
    const legacy = {
      version: 1,
      runtime: {
        interactive: {
          recentAgent: 'pi',
          agents: { pi: { accessMode: 'native', model: 'pi-model' } },
        },
        headless: {
          recentAgent: 'codex',
          agents: { codex: { accessMode: 'native', model: 'codex-model' } },
        },
      },
    }
    await writeSettings(root, 'workspaces', 'active-one', legacy)
    await writeSettings(root, 'departed-workspaces', 'departed-one', legacy)

    expect(await migrateWorkspaceRuntimeSettingsV2(root, { backupRoot })).toEqual({
      scanned: 2,
      migrated: 2,
      current: 0,
      skipped: 0,
    })
    const migrated = JSON.parse(await readFile(
      join(root, 'workspaces', 'active-one', '.alice', 'settings.json'),
      'utf8',
    )) as Record<string, unknown>
    expect(migrated).toMatchObject({
      version: 2,
      runtime: {
        askAlice: {
          agents: {},
          recent: { agent: 'pi', agents: { pi: { accessMode: 'native', model: 'pi-model' } } },
        },
        issues: {
          agents: {},
          recent: { agent: 'codex', agents: { codex: { accessMode: 'native', model: 'codex-model' } } },
        },
      },
    })
    expect(JSON.parse(await readFile(
      join(backupRoot, 'active', 'active-one', '.alice', 'settings.json'),
      'utf8',
    ))).toEqual(legacy)

    expect(await migrateWorkspaceRuntimeSettingsV2(root, { backupRoot })).toEqual({
      scanned: 2,
      migrated: 0,
      current: 2,
      skipped: 0,
    })
  })

  it('leaves current and malformed files untouched', async () => {
    const root = await fixture()
    await writeSettings(root, 'workspaces', 'current', {
      version: 2,
      runtime: {
        askAlice: { agents: {}, recent: { agents: {} } },
        issues: { agents: {}, recent: { agents: {} } },
      },
    })
    const malformedPath = join(root, 'workspaces', 'malformed', '.alice', 'settings.json')
    await mkdir(dirname(malformedPath), { recursive: true })
    await writeFile(malformedPath, '{ definitely not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await migrateWorkspaceRuntimeSettingsV2(root)).toEqual({
      scanned: 2,
      migrated: 0,
      current: 1,
      skipped: 1,
    })
    expect(await readFile(malformedPath, 'utf8')).toBe('{ definitely not json')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
