import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyWorkspaceRuntimeSettings } from '../workspaces/workspace-runtime-settings.js'
import { migrateWorkspaceDefaultAgent } from './0042_workspace_default_agent/index.js'

let root: string
let dir: string
const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-default-migration-'))
  dir = join(root, 'workspace', '.alice')
  await mkdir(dir, { recursive: true })
  await mkdir(join(root, 'state'))
  await writeFile(join(root, 'state', 'workspace-catalog.json'), JSON.stringify({
    version: 1, workspaces: [{ activeDir: join(root, 'workspace'), lifecycle: 'active' }],
  }))
  await writeFile(join(dir, 'workspace.json'), JSON.stringify({ displayName: 'Research', defaultAgent: 'codex' }))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('Workspace default Agent migration', () => {
  it('moves the old default, preserves display metadata, and is idempotent', async () => {
    await migrateWorkspaceDefaultAgent(root)
    const settings = await read(join(dir, 'settings.json'))
    expect(settings.runtime.interactive.defaultAgent).toBe('codex')
    expect(settings.runtime.headless.defaultAgent).toBeUndefined()
    expect(await read(join(dir, 'workspace.json'))).toEqual({ displayName: 'Research' })
    await migrateWorkspaceDefaultAgent(root)
    expect(await read(join(dir, 'settings.json'))).toEqual(settings)
  })

  it('preserves explicit defaults, model preferences, and recent history', async () => {
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.interactive.defaultAgent = 'claude'
    settings.runtime.interactive.recent.agent = 'pi'
    settings.runtime.headless.defaultAgent = 'codex'
    settings.runtime.headless.agents.codex = { accessMode: 'native', model: 'gpt-5.6-sol', reasoningEffort: 'medium' }
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings))
    await migrateWorkspaceDefaultAgent(root)
    expect(await read(join(dir, 'settings.json'))).toEqual(settings)
    expect(await read(join(dir, 'workspace.json'))).toEqual({ displayName: 'Research' })
  })

  it('does not discard the old choice when the destination is invalid', async () => {
    await writeFile(join(dir, 'settings.json'), '{broken')
    await expect(migrateWorkspaceDefaultAgent(root)).rejects.toThrow()
    expect((await read(join(dir, 'workspace.json'))).defaultAgent).toBe('codex')
  })
})
