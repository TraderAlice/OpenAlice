import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Credential } from '../core/config.js'
import { claudeAdapter } from '../workspaces/adapters/claude.js'
import { codexAdapter } from '../workspaces/adapters/codex.js'
import { shellAdapter } from '../workspaces/adapters/shell.js'
import {
  AUTO_QUANT_WORKSPACE_TEMPLATE,
  CHAT_WORKSPACE_TEMPLATE,
} from '../workspaces/chat-workspace-resolver.js'
import type { CliAdapter } from '../workspaces/cli-adapter.js'
import type { WorkspaceService } from '../workspaces/service.js'
import type { WorkspaceMeta } from '../workspaces/workspace-registry.js'
import {
  emptyWorkspaceRuntimeSettings,
  readWorkspaceRuntimeSettings,
  writeWorkspaceRuntimeSettings,
} from '../workspaces/workspace-runtime-settings.js'
import { makeWorkspaceRuntimeControl } from './workspace-runtime-control.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ws-runtime-control-'))
  tempDirs.push(dir)
  return dir
}

const interactiveOnlyAdapter: CliAdapter = {
  ...claudeAdapter,
  id: 'tui-only',
  displayName: 'TUI Only',
  capabilities: { ...claudeAdapter.capabilities, headless: false },
  composeHeadlessCommand: undefined,
}

function makeFakeService(workspaces: WorkspaceMeta[], defaultHeadlessAgent = 'codex'): WorkspaceService {
  const byId = new Map(workspaces.map((ws) => [ws.id, ws]))
  const adapters = new Map<string, CliAdapter>([
    [codexAdapter.id, codexAdapter],
    [claudeAdapter.id, claudeAdapter],
    [interactiveOnlyAdapter.id, interactiveOnlyAdapter],
    [shellAdapter.id, shellAdapter],
  ])
  return {
    registry: {
      get: (id: string) => byId.get(id),
      list: () => workspaces,
    },
    adapters: {
      get: (id: string) => adapters.get(id),
    },
    resolveHeadlessDefaultAgentId: async () => defaultHeadlessAgent,
  } as unknown as WorkspaceService
}

describe('makeWorkspaceRuntimeControl', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      await rm(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  it('inspects and clears stale persisted model on AutoQuant via --harness autoquant --model default', async () => {
    const aqDir = await makeTempDir()
    const aqMeta: WorkspaceMeta = {
      id: 'ws-aq',
      tag: 'AutoQuant',
      dir: aqDir,
      template: AUTO_QUANT_WORKSPACE_TEMPLATE,
      createdAt: new Date(0).toISOString(),
    }
    const initial = emptyWorkspaceRuntimeSettings()
    initial.runtime.interactive = {
      defaultAgent: 'codex',
      agents: { codex: { accessMode: 'native', model: 'gpt-5.6-sol', reasoningEffort: 'high' } },
      recent: { agents: {} },
    }
    initial.runtime.headless = {
      defaultAgent: 'codex',
      agents: {},
      recent: {
        agent: 'codex',
        agents: { codex: { accessMode: 'native', model: 'gpt-5.6-sol', reasoningEffort: 'medium' } },
      },
    }
    await writeWorkspaceRuntimeSettings(aqDir, initial)

    const svc = makeFakeService([aqMeta])
    const control = makeWorkspaceRuntimeControl(svc, {
      readAutoQuantPreferences: async () => ({ defaultWorkspaceId: 'ws-aq' }),
    })

    const before = await control.get({ harness: 'autoquant' }) as Record<string, any>
    expect(before.workspace).toEqual({ id: 'ws-aq', tag: 'AutoQuant', template: AUTO_QUANT_WORKSPACE_TEMPLATE })
    expect(before.runtime.interactive.effective).toEqual({
      agent: 'codex',
      credentialSource: 'native',
      model: 'gpt-5.6-sol',
      effort: 'high',
    })
    expect(before.runtime.headless.effective).toEqual({
      agent: 'codex',
      credentialSource: 'native',
      model: 'gpt-5.6-sol',
      effort: 'medium',
    })

    const after = await control.set({ harness: 'autoquant', model: 'default' }) as Record<string, any>
    expect(after.runtime.interactive.effective).toEqual({
      agent: 'codex',
      credentialSource: 'native',
      model: null,
      effort: 'high',
    })
    expect(after.runtime.headless.effective).toEqual({
      agent: 'codex',
      credentialSource: 'native',
      model: null,
      effort: 'medium',
    })

    // Persisted file uses canonical schema v3 and shadows recent without storing "default"
    const persisted = await readWorkspaceRuntimeSettings(aqDir)
    expect(persisted.ok).toBe(true)
    if (persisted.ok) {
      expect(persisted.settings.runtime.interactive.agents.codex).toEqual({
        accessMode: 'native',
        reasoningEffort: 'high',
      })
      expect(persisted.settings.runtime.headless.agents.codex).toEqual({
        accessMode: 'native',
        reasoningEffort: 'medium',
      })
    }
  })

  it('validates vault credentials and drops previous credential model/effort when switching credentials', async () => {
    const dir = await makeTempDir()
    const chatMeta: WorkspaceMeta = {
      id: 'ws-chat',
      tag: 'Chat',
      dir,
      template: CHAT_WORKSPACE_TEMPLATE,
      createdAt: new Date(0).toISOString(),
    }
    const creds: Record<string, Credential> = {
      'openai-1': {
        vendor: 'openai',
        label: 'OpenAI',
        authType: 'api-key',
        apiKey: 'sk-test-only',
        wires: { 'openai-responses': '' },
      },
      'anthropic-1': {
        vendor: 'anthropic',
        label: 'Anthropic',
        authType: 'api-key',
        apiKey: 'sk-ant-test-only',
        wires: { anthropic: '' },
      },
    }
    const svc = makeFakeService([chatMeta])
    const control = makeWorkspaceRuntimeControl(svc, {
      readCredentials: async () => creds,
      readQuickChatPreferences: async () => ({ recentChatWorkspaceId: 'ws-chat' }),
    })

    // Set vault credential + model + effort on headless only
    const updated = await control.set({
      harness: 'chat',
      mode: 'headless',
      agent: 'codex',
      credential: 'openai-1',
      model: 'gpt-6-astra',
      effort: 'high',
    }) as Record<string, any>
    expect(updated.runtime.headless.effective).toEqual({
      agent: 'codex',
      credentialSource: 'vault',
      credential: 'openai-1',
      model: 'gpt-6-astra',
      effort: 'high',
    })

    // Switching back to native clears the vault model/effort unless re-specified
    const nativeReset = await control.set({
      wsId: 'Chat',
      mode: 'headless',
      credentialSource: 'native',
    }) as Record<string, any>
    expect(nativeReset.runtime.headless.effective).toEqual({
      agent: 'codex',
      credentialSource: 'native',
      model: null,
      effort: null,
    })

    // Incompatible credential rejected cleanly
    await expect(control.set({
      wsId: 'ws-chat',
      mode: 'headless',
      agent: 'codex',
      credential: 'anthropic-1',
    })).rejects.toThrow(/not compatible with codex/)

    // Non-agent runtime rejected
    await expect(control.set({
      wsId: 'ws-chat',
      agent: 'shell',
    })).rejects.toThrow(/unknown agent runtime: shell/)

    // Non-headless runtime rejected when headless mode is included
    await expect(control.set({
      wsId: 'ws-chat',
      agent: 'tui-only',
    })).rejects.toThrow(/does not support headless launches: tui-only \(pass --mode interactive\)/)

    // Interactive-only update succeeds
    const tuiOnlyRes = await control.set({
      wsId: 'ws-chat',
      mode: 'interactive',
      agent: 'tui-only',
    }) as Record<string, any>
    expect(tuiOnlyRes.runtime.interactive.defaultAgent).toBe('tui-only')
  })

  it('rejects uninitialized harness and workspace-manager without explicit target', async () => {
    const svc = makeFakeService([])
    const control = makeWorkspaceRuntimeControl(svc, {
      readAutoQuantPreferences: async () => ({ defaultWorkspaceId: null }),
    })

    await expect(control.get({ harness: 'autoquant' })).rejects.toThrow(/AutoQuant workspace is not initialized/)
    await expect(control.get({ wsId: 'workspace-manager' })).rejects.toThrow(/workspace-manager has no business runtime settings/)
  })
})
