import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { migratePiNativeWorkspaceConfig } from './0024_pi_native_workspace_config/index.js'

let root: string
let agentDir: string
let backupRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-native-migration-'))
  agentDir = join(root, 'pi-user-agent')
  backupRoot = join(root, 'backup')
})

afterEach(async () => rm(root, { recursive: true, force: true }))

async function seedLegacy(workspace: string, model: string): Promise<void> {
  const legacy = join(workspace, '.pi-agent')
  await mkdir(join(legacy, 'sessions', model), { recursive: true })
  await writeFile(join(legacy, 'models.json'), JSON.stringify({
    legacyMetadata: model,
    providers: {
      workspace: {
        name: 'OpenAlice workspace provider',
        api: 'openai-completions',
        baseUrl: 'https://legacy/v1',
        apiKey: `${model}-key`,
        models: [{ id: model, reasoning: true }],
      },
    },
  }))
  await writeFile(join(legacy, 'settings.json'), JSON.stringify({
    defaultProvider: 'workspace',
    defaultModel: model,
  }))
  await writeFile(join(legacy, 'sessions', model, 'turn.jsonl'), '{}\n')
}

describe('0024 Pi native Workspace config', () => {
  it('backs up and migrates active and departed Workspaces idempotently', async () => {
    const active = join(root, 'workspaces', 'workspaces', 'chat-active')
    const departed = join(root, 'workspaces', 'departed-workspaces', 'chat-departed')
    await seedLegacy(active, 'active-model')
    await seedLegacy(departed, 'departed-model')
    await symlink('sessions', join(active, '.pi-agent', 'session-link'))

    await expect(migratePiNativeWorkspaceConfig(join(root, 'workspaces'), {
      env: { PI_CODING_AGENT_DIR: agentDir, HOME: join(root, 'home') },
      backupRoot,
    })).resolves.toEqual({ found: 2, migrated: 2, failed: 0 })

    expect(existsSync(join(active, '.pi-agent'))).toBe(false)
    expect(existsSync(join(departed, '.pi-agent'))).toBe(false)
    expect(existsSync(join(backupRoot, 'active', 'chat-active', '.pi-agent', 'models.json'))).toBe(true)
    expect(existsSync(join(backupRoot, 'departed', 'chat-departed', '.pi-agent', 'models.json'))).toBe(true)
    expect(await readFile(join(agentDir, 'sessions', 'active-model', 'turn.jsonl'), 'utf8')).toBe('{}\n')
    expect(await readFile(join(agentDir, 'sessions', 'departed-model', 'turn.jsonl'), 'utf8')).toBe('{}\n')
    expect(await readlink(join(agentDir, 'session-link'))).toBe('sessions')
    expect(JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8')).legacyMetadata)
      .toBe('active-model')
    expect(JSON.parse(await readFile(join(active, '.pi', 'settings.json'), 'utf8')).defaultModel)
      .toBe('active-model')
    expect(JSON.parse(await readFile(join(departed, '.pi', 'settings.json'), 'utf8')).defaultModel)
      .toBe('departed-model')

    await expect(migratePiNativeWorkspaceConfig(join(root, 'workspaces'), {
      env: { PI_CODING_AGENT_DIR: agentDir },
      backupRoot,
    })).resolves.toEqual({ found: 0, migrated: 0, failed: 0 })
  })

  it('keeps and backs up a legacy tree when the user model registry is malformed', async () => {
    const workspace = join(root, 'workspaces', 'workspaces', 'chat-broken')
    await seedLegacy(workspace, 'broken-model')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'models.json'), '{ repairing')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(migratePiNativeWorkspaceConfig(join(root, 'workspaces'), {
      env: { PI_CODING_AGENT_DIR: agentDir },
      backupRoot,
    })).resolves.toEqual({ found: 1, migrated: 0, failed: 1 })
    expect(existsSync(join(workspace, '.pi-agent', 'models.json'))).toBe(true)
    expect(existsSync(join(backupRoot, 'active', 'chat-broken', '.pi-agent', 'models.json'))).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
