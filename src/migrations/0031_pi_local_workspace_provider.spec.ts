import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { migratePiLocalWorkspaceProviders } from './0031_pi_local_workspace_provider/index.js'
import {
  PI_PROVIDER_EXTENSION_PATH,
  piWorkspaceProviderId,
} from '../workspaces/adapters/pi-config.js'

let root: string
let launcherRoot: string
let agentDir: string
let backupRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-local-provider-migration-'))
  launcherRoot = join(root, 'workspaces')
  agentDir = join(root, 'pi-agent')
  backupRoot = join(root, 'backup')
})

afterEach(async () => rm(root, { recursive: true, force: true }))

async function seedLegacyBinding(
  workspace: string,
  selectedModel: string,
  globalModel = selectedModel,
): Promise<string> {
  const providerId = piWorkspaceProviderId(workspace)
  await mkdir(join(workspace, '.pi'), { recursive: true })
  await writeFile(join(workspace, '.pi/settings.json'), JSON.stringify({
    defaultProvider: providerId,
    defaultModel: selectedModel,
  }))
  await writeFile(join(workspace, '.pi/openalice-provider.json'), JSON.stringify({
    version: 1,
    providerId,
    previous: {
      defaultProvider: { present: false },
      defaultModel: { present: false },
      shellPath: { present: false },
    },
    injected: {
      defaultProvider: { present: true, value: providerId },
      defaultModel: { present: true, value: selectedModel },
      shellPath: { present: false },
    },
  }))
  return globalModel
}

describe('0031 Pi local Workspace provider', () => {
  it('backs up and localizes active/departed bindings, repairs tears, and removes stale global nodes', async () => {
    const active = join(launcherRoot, 'workspaces', 'chat-active')
    const departed = join(launcherRoot, 'departed-workspaces', 'chat-departed')
    const activeGlobalModel = await seedLegacyBinding(active, 'active-intended', 'active-stale')
    const departedGlobalModel = await seedLegacyBinding(departed, 'departed-model')
    const activeProviderId = piWorkspaceProviderId(active)
    const departedProviderId = piWorkspaceProviderId(departed)
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({
      metadata: 'preserve',
      providers: {
        [activeProviderId]: {
          name: `OpenAlice workspace provider (${basename(active)})`,
          api: 'openai-completions',
          baseUrl: 'https://active.test/v1',
          apiKey: 'active-key',
          models: [{ id: activeGlobalModel, reasoning: true }],
        },
        [departedProviderId]: {
          name: `OpenAlice workspace provider (${basename(departed)})`,
          api: 'anthropic-messages',
          baseUrl: 'https://departed.test/anthropic',
          apiKey: 'departed-key',
          models: [{ id: departedGlobalModel }],
        },
        'openalice-workspace-stale': {
          name: 'OpenAlice workspace provider (deleted)',
          api: 'openai-completions',
          models: [{ id: 'stale' }],
        },
        user: { name: 'User provider', api: 'openai-completions' },
      },
    }))

    await expect(migratePiLocalWorkspaceProviders(launcherRoot, {
      env: { PI_CODING_AGENT_DIR: agentDir },
      backupRoot,
    })).resolves.toEqual({ found: 2, migrated: 2, failed: 0, removedGlobal: 1 })

    const activeState = JSON.parse(await readFile(join(active, '.pi/openalice-provider.json'), 'utf8'))
    const departedState = JSON.parse(await readFile(join(departed, '.pi/openalice-provider.json'), 'utf8'))
    expect(activeState.version).toBe(2)
    expect(activeState.provider.models).toEqual([{ id: 'active-intended' }])
    expect(departedState.version).toBe(2)
    expect(departedState.provider.models).toEqual([{ id: 'departed-model' }])
    expect(existsSync(join(active, PI_PROVIDER_EXTENSION_PATH))).toBe(true)
    expect(existsSync(join(departed, PI_PROVIDER_EXTENSION_PATH))).toBe(true)
    expect(existsSync(join(backupRoot, 'active/chat-active/.pi/settings.json'))).toBe(true)
    expect(existsSync(join(backupRoot, 'pi-agent/models.json'))).toBe(true)
    expect(JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'))).toEqual({
      metadata: 'preserve',
      providers: { user: { name: 'User provider', api: 'openai-completions' } },
    })

    await expect(migratePiLocalWorkspaceProviders(launcherRoot, {
      env: { PI_CODING_AGENT_DIR: agentDir },
    })).resolves.toEqual({ found: 2, migrated: 0, failed: 0, removedGlobal: 0 })
  })

  it('keeps a global provider when its Workspace binding cannot be localized', async () => {
    const workspace = join(launcherRoot, 'workspaces', 'chat-broken')
    const providerId = piWorkspaceProviderId(workspace)
    await mkdir(join(workspace, '.pi'), { recursive: true })
    await writeFile(join(workspace, '.pi/settings.json'), JSON.stringify({
      defaultProvider: providerId,
      defaultModel: 'broken-model',
    }))
    await writeFile(join(workspace, '.pi/openalice-provider.json'), '{ user is repairing')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        [providerId]: {
          name: `OpenAlice workspace provider (${basename(workspace)})`,
          api: 'openai-completions',
          models: [{ id: 'broken-model' }],
        },
      },
    }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(migratePiLocalWorkspaceProviders(launcherRoot, {
      env: { PI_CODING_AGENT_DIR: agentDir },
      backupRoot,
    })).resolves.toEqual({ found: 1, migrated: 0, failed: 1, removedGlobal: 0 })
    expect(JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8')).providers[providerId])
      .toBeDefined()
    expect(existsSync(join(backupRoot, 'active/chat-broken/.pi/openalice-provider.json'))).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
