import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { migrateWorkspaceRuntimeModes } from './0038_workspace_runtime_modes/index.js'

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'workspace-runtime-modes-'))
}

async function writeSettings(root: string, kind: 'workspaces' | 'departed-workspaces', name: string, value: unknown) {
  const dir = join(root, kind, name, '.alice')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'settings.json'), `${JSON.stringify(value, null, 2)}\n`)
}

const legacy = {
  version: 2,
  runtime: {
    askAlice: {
      defaultAgent: 'pi',
      agents: { pi: { accessMode: 'native', model: 'interactive-model' } },
      recent: { agent: 'codex', agents: { codex: { accessMode: 'native' } } },
    },
    issues: {
      defaultAgent: 'codex',
      agents: { codex: { accessMode: 'native', reasoningEffort: 'low' } },
      recent: { agents: {} },
    },
  },
}

describe('0038 Workspace runtime modes migration', () => {
  it('preserves active and departed preferences under mode-based keys', async () => {
    const root = await fixture()
    const backupRoot = join(root, 'backups')
    await writeSettings(root, 'workspaces', 'active-one', legacy)
    await writeSettings(root, 'departed-workspaces', 'departed-one', legacy)

    expect(await migrateWorkspaceRuntimeModes(root, { backupRoot })).toEqual({
      scanned: 2, migrated: 2, current: 0, skipped: 0,
    })
    expect(JSON.parse(await readFile(join(root, 'workspaces', 'active-one', '.alice', 'settings.json'), 'utf8'))).toEqual({
      version: 3,
      runtime: {
        interactive: legacy.runtime.askAlice,
        headless: legacy.runtime.issues,
      },
    })
    expect(JSON.parse(await readFile(join(backupRoot, 'active', 'active-one', '.alice', 'settings.json'), 'utf8'))).toEqual(legacy)
    expect(await migrateWorkspaceRuntimeModes(root, { backupRoot })).toEqual({
      scanned: 2, migrated: 0, current: 2, skipped: 0,
    })
  })

  it('leaves current and malformed files untouched', async () => {
    const root = await fixture()
    await writeSettings(root, 'workspaces', 'current', {
      version: 3,
      runtime: {
        interactive: { agents: {}, recent: { agents: {} } },
        headless: { agents: {}, recent: { agents: {} } },
      },
    })
    const malformedPath = join(root, 'workspaces', 'malformed', '.alice', 'settings.json')
    await mkdir(dirname(malformedPath), { recursive: true })
    await writeFile(malformedPath, '{ definitely not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await migrateWorkspaceRuntimeModes(root)).toEqual({
      scanned: 2, migrated: 0, current: 1, skipped: 1,
    })
    expect(await readFile(malformedPath, 'utf8')).toBe('{ definitely not json')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
