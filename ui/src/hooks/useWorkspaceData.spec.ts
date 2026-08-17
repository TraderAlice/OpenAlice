// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Workspace } from '../components/workspace/api'
import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import { useWorkspaceData, useWorkspaceSessionData } from './useWorkspaceData'

const mocks = vi.hoisted(() => ({
  context: null as WorkspacesContextValue | null,
  updatePausedSessionRuntime: vi.fn(),
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return { ...actual, updatePausedSessionRuntime: mocks.updatePausedSessionRuntime }
})

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => {
    if (!mocks.context) throw new Error('missing test context')
    return mocks.context
  },
}))

const refresh = vi.fn(async () => {})

function workspace(): Workspace {
  return {
    id: 'workspace-1',
    tag: 'chat-aug11',
    dir: '/tmp/chat-aug11',
    createdAt: '2026-08-11T00:00:00.000Z',
    sessions: [{
      id: 'session-1',
      resumeId: 'resume-1',
      wsId: 'workspace-1',
      agent: 'claude',
      name: 'c1',
      createdAt: '2026-08-11T00:00:00.000Z',
      lastActiveAt: '2026-08-11T00:01:00.000Z',
      state: 'paused',
      surface: 'terminal',
      pid: null,
      startedAt: null,
      title: 'Vault-backed session',
      runtime: {
        credentialSource: 'vault',
        credentialSlug: 'deepseek-1',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      },
    }],
  }
}

function context(overrides: Partial<WorkspacesContextValue> = {}): WorkspacesContextValue {
  return {
    workspaces: [workspace()],
    hasLoaded: true,
    listError: null,
    refresh,
    ...overrides,
  } as WorkspacesContextValue
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context = context()
  mocks.updatePausedSessionRuntime.mockResolvedValue(workspace().sessions[0])
})

describe('Workspace data hooks', () => {
  it('selects the Workspace and its secret-free Session binding', () => {
    const { result } = renderHook(() =>
      useWorkspaceSessionData('workspace-1', 'session-1'),
    )

    expect(result.current.workspace?.tag).toBe('chat-aug11')
    expect(result.current.session?.runtime).toEqual({
      credentialSource: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.refresh).toBe(refresh)
  })

  it('preserves loading and backend error semantics for a missing Workspace', () => {
    mocks.context = context({ workspaces: [], hasLoaded: false, listError: 'offline' })

    const { result } = renderHook(() => useWorkspaceData('missing'))

    expect(result.current.workspace).toBeNull()
    expect(result.current.sessions).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBe('offline')
  })

  it('does not fall back to another Session when the requested id is missing', () => {
    const { result } = renderHook(() =>
      useWorkspaceSessionData('workspace-1', 'missing'),
    )

    expect(result.current.session).toBeNull()
  })

  it('updates a paused Session through the domain hook and refreshes the snapshot', async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessionData('workspace-1', 'session-1'),
    )

    await act(async () => {
      await result.current.updateRuntime({
        credentialSource: 'native',
        model: 'claude-sonnet-4-5',
        reasoningEffort: 'low',
      })
    })

    expect(mocks.updatePausedSessionRuntime).toHaveBeenCalledWith(
      'workspace-1',
      'session-1',
      {
        credentialSource: 'native',
        model: 'claude-sonnet-4-5',
        reasoningEffort: 'low',
      },
    )
    expect(refresh).toHaveBeenCalledOnce()
  })
})
