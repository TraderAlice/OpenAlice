// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentInfo } from '../components/workspace/api'
import { resetAgentRuntimesStore } from './useAgentRuntimes'
import {
  formatPinnedCapability,
  pinnedLaunchEquals,
  pinnedLaunchFromBinding,
  pinnedLaunchToRuntimeUpdate,
  usePinnedRuntimeDraft,
} from './usePinnedRuntimeDraft'

const mocks = vi.hoisted(() => ({
  listAgentCredentials: vi.fn(),
  getAgentRuntimeReadiness: vi.fn(),
  getPresets: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  rememberQuickChatLaunch: vi.fn(),
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return {
    ...actual,
    listAgentCredentials: mocks.listAgentCredentials,
    getAgentRuntimeReadiness: mocks.getAgentRuntimeReadiness,
    listAgents: vi.fn(async () => []),
    detectWorkspaceCredential: vi.fn(),
    getAgentReadiness: vi.fn(),
  }
})

vi.mock('../api/config', () => ({
  configApi: {
    getPresets: mocks.getPresets,
    getWorkspaceCredentialDefaults: mocks.getWorkspaceCredentialDefaults,
  },
}))

vi.mock('../api/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/preferences')>()
  return {
    ...actual,
    preferencesApi: {
      ...actual.preferencesApi,
      rememberQuickChatLaunch: mocks.rememberQuickChatLaunch,
      getQuickChat: vi.fn(),
    },
  }
})

const codex: AgentInfo = {
  id: 'codex',
  displayName: 'Codex',
  kind: 'agent',
  installed: true,
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'subprocess',
    aiProvider: {
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['openai-responses'],
    },
  },
}

const initial = pinnedLaunchFromBinding('codex', {
  credentialSource: 'native',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'high',
})

beforeEach(() => {
  resetAgentRuntimesStore()
  mocks.listAgentCredentials.mockResolvedValue([{
    slug: 'openrouter-1',
    vendor: 'openrouter',
    label: 'OpenRouter',
    authType: 'api-key',
    resolvedModel: 'openai/gpt-5.4',
  }])
  mocks.getAgentRuntimeReadiness.mockResolvedValue({
    checkedAt: '2026-08-17T00:00:00.000Z',
    overallReady: true,
    agents: {
      codex: {
        agent: 'codex',
        displayName: 'Codex',
        installed: true,
        binPath: null,
        status: 'ready',
        ready: true,
        source: 'global-login',
        checkedAt: '2026-08-17T00:00:00.000Z',
        durationMs: 1,
        message: 'ready',
      },
    },
  })
  mocks.getPresets.mockResolvedValue({ presets: [] })
  mocks.getWorkspaceCredentialDefaults.mockResolvedValue({ defaults: {} })
  mocks.rememberQuickChatLaunch.mockReset()
})

describe('pinned launch helpers', () => {
  it('maps a vault binding to a native-or-vault launch and back', () => {
    const launch = pinnedLaunchFromBinding('codex', {
      credentialSource: 'vault',
      credentialSlug: 'openrouter-1',
      model: 'openrouter/new-model',
      reasoningEffort: 'low',
    })
    expect(launch).toEqual({
      agent: 'codex',
      accessMode: 'vault',
      credentialSlug: 'openrouter-1',
      model: 'openrouter/new-model',
      reasoningEffort: 'low',
    })
    expect(pinnedLaunchToRuntimeUpdate(launch)).toEqual({
      credentialSource: 'vault',
      credentialSlug: 'openrouter-1',
      model: 'openrouter/new-model',
      reasoningEffort: 'low',
    })
    expect(pinnedLaunchEquals(launch, { ...launch })).toBe(true)
    expect(formatPinnedCapability({
      access: 'OpenRouter',
      model: 'openrouter/new-model',
      effort: 'low',
    })).toBe('OpenRouter · openrouter/new-model · low')
  })

  it('treats a missing vault slug as native', () => {
    expect(pinnedLaunchFromBinding('pi', { credentialSource: 'vault' })).toEqual({
      agent: 'pi',
      accessMode: 'native',
      credentialSlug: null,
      model: null,
      reasoningEffort: null,
    })
  })
})

describe('usePinnedRuntimeDraft', () => {
  it('keeps custom model ids in the local draft and never remembers launch recents', async () => {
    const { result } = renderHook(() => usePinnedRuntimeDraft({
      workspaceId: 'ws-1',
      agent: 'codex',
      agents: [codex],
      initial,
    }))

    await waitFor(() => expect(result.current.config.credentialSelectionReady).toBe(true))
    expect(result.current.dirty).toBe(false)
    expect(result.current.toRuntimeUpdate()).toEqual({
      credentialSource: 'native',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })

    act(() => {
      result.current.config.selectModel('openrouter/some-new-id')
    })

    await waitFor(() => expect(result.current.dirty).toBe(true))
    expect(result.current.toRuntimeUpdate()).toEqual({
      credentialSource: 'native',
      model: 'openrouter/some-new-id',
      reasoningEffort: null,
    })
    expect(result.current.formatCapability({
      access: 'Runtime managed',
      model: 'runtime',
      effort: 'runtime',
    })).toContain('openrouter/some-new-id')
    expect(mocks.rememberQuickChatLaunch).not.toHaveBeenCalled()
  })

  it('resets to the persisted binding when the editor becomes active again', async () => {
    const { result, rerender } = renderHook(
      ({ active }) => usePinnedRuntimeDraft({
        workspaceId: 'ws-1',
        agent: 'codex',
        agents: [codex],
        initial,
        active,
      }),
      { initialProps: { active: true } },
    )

    await waitFor(() => expect(result.current.config.credentialSelectionReady).toBe(true))
    act(() => {
      result.current.config.selectReasoningEffort('low')
    })
    await waitFor(() => expect(result.current.dirty).toBe(true))

    rerender({ active: false })
    rerender({ active: true })
    await waitFor(() => expect(result.current.dirty).toBe(false))
    expect(result.current.toRuntimeUpdate().reasoningEffort).toBe('high')
  })
})
