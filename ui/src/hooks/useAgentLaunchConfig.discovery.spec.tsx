// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentInfo, SavedCredential } from '../components/workspace/api'
import type { AgentLaunchPreferencesState } from './useAgentLaunchConfig'
import { useAgentLaunchConfig } from './useAgentLaunchConfig'

const { discoverModelsMock, getDefaultsMock, getPresetsMock, listAgentCredentialsMock } = vi.hoisted(() => ({
  discoverModelsMock: vi.fn(),
  getDefaultsMock: vi.fn(),
  getPresetsMock: vi.fn(),
  listAgentCredentialsMock: vi.fn(),
}))

vi.mock('../api/config', () => ({
  configApi: {
    discoverModels: discoverModelsMock,
    getPresets: getPresetsMock,
    getWorkspaceCredentialDefaults: getDefaultsMock,
  },
}))

vi.mock('../api/preferences', () => ({ preferencesApi: {} }))
vi.mock('./useAgentRuntimes', () => ({ useAgentRuntimes: () => ({ readiness: null }) }))
vi.mock('../components/workspace/api', () => ({
  detectWorkspaceCredential: vi.fn(),
  getAgentReadiness: vi.fn(),
  listAgentCredentials: listAgentCredentialsMock,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const agent: AgentInfo = {
  id: 'codex',
  displayName: 'Codex',
  installed: true,
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'subprocess',
    aiProvider: { credentialSource: 'runtime-or-workspace', wirePreference: ['openai-chat'] },
  },
}

function credential(slug: string, model: string): SavedCredential {
  return {
    slug,
    vendor: 'openai',
    authType: 'api-key',
    wires: { 'openai-chat': 'https://gateway.example/v1' },
    resolvedModel: model,
  }
}

function preferences(slug: string): AgentLaunchPreferencesState {
  return {
    lastCredentialByAgent: {},
    recentChatWorkspaceId: null,
    recentLaunch: {
      agent: 'codex',
      accessMode: 'vault',
      credentialSlug: slug,
      model: null,
      reasoningEffort: null,
    },
    loaded: true,
    rememberLaunch: vi.fn().mockResolvedValue(undefined),
    adoptRecentChatWorkspace: vi.fn(),
  }
}

function setupMocks(credentials: SavedCredential[]) {
  getPresetsMock.mockResolvedValue({ presets: [] })
  getDefaultsMock.mockResolvedValue({ defaults: {}, compatibleByAgent: {} })
  listAgentCredentialsMock.mockResolvedValue(credentials)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useAgentLaunchConfig model discovery', () => {
  it('adds a discovered model while readiness remains immediately usable', async () => {
    const pending = deferred<{ status: 'success'; models: string[] }>()
    const saved = credential('credential-a', 'gpt-current')
    setupMocks([saved])
    discoverModelsMock.mockReturnValue(pending.promise)

    const hook = renderHook(() => useAgentLaunchConfig({
      agents: [agent],
      defaultAgent: 'codex',
      preferences: preferences('credential-a'),
      workspaceId: null,
      hasWorkspace: false,
    }))

    await waitFor(() => expect(discoverModelsMock).toHaveBeenCalledWith({ credentialSlug: 'credential-a' }))
    expect(hook.result.current.credentialSelectionReady).toBe(true)
    expect(hook.result.current.modelOptions.map((option) => option.id)).not.toContain('discovered-model')

    await act(async () => {
      pending.resolve({ status: 'success', models: ['discovered-model'] })
      await pending.promise
    })
    await waitFor(() => expect(hook.result.current.modelOptions.map((option) => option.id)).toContain('discovered-model'))
    expect(hook.result.current.credentialSelectionReady).toBe(true)
    expect(hook.result.current.defaultModel).toBe('gpt-current')
  })

  it('rejects a late response from the previous selected credential', async () => {
    const first = deferred<{ status: 'success'; models: string[] }>()
    const second = deferred<{ status: 'success'; models: string[] }>()
    const credentials = [credential('credential-a', 'model-a'), credential('credential-b', 'model-b')]
    setupMocks(credentials)
    discoverModelsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const hook = renderHook(
      ({ selectedSlug }: { selectedSlug: string }) => useAgentLaunchConfig({
        agents: [agent],
        defaultAgent: 'codex',
        preferences: preferences(selectedSlug),
        workspaceId: null,
        hasWorkspace: false,
      }),
      { initialProps: { selectedSlug: 'credential-a' } },
    )

    await waitFor(() => expect(discoverModelsMock).toHaveBeenCalledWith({ credentialSlug: 'credential-a' }))
    hook.rerender({ selectedSlug: 'credential-b' })
    await waitFor(() => expect(discoverModelsMock).toHaveBeenCalledWith({ credentialSlug: 'credential-b' }))

    await act(async () => {
      first.resolve({ status: 'success', models: ['model-from-a'] })
      await first.promise
    })
    expect(hook.result.current.modelOptions.map((option) => option.id)).not.toContain('model-from-a')

    await act(async () => {
      second.resolve({ status: 'success', models: ['model-from-b'] })
      await second.promise
    })
    await waitFor(() => expect(hook.result.current.modelOptions.map((option) => option.id)).toContain('model-from-b'))
    expect(hook.result.current.defaultModel).toBe('model-b')
  })
})
