// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceSessionDirectory } from '../components/workspace/api'
import {
  useWorkspaceSessionDirectories,
  useWorkspaceSessionDirectory,
} from './useWorkspaceSessionDirectory'

const mocks = vi.hoisted(() => ({
  getWorkspaceSessionDirectory: vi.fn(),
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return {
    ...actual,
    getWorkspaceSessionDirectory: mocks.getWorkspaceSessionDirectory,
  }
})

function directory(workspaceId: string): WorkspaceSessionDirectory {
  return {
    workspace: { id: workspaceId, tag: workspaceId },
    sessions: [{
      resumeId: `resume-${workspaceId}`,
      agent: 'codex',
      createdAt: 1,
      updatedAt: 2,
      lifecycle: 'active',
      resumable: true,
      active: false,
    }],
  }
}

beforeEach(() => {
  mocks.getWorkspaceSessionDirectory.mockImplementation(async (workspaceId: string) =>
    directory(workspaceId))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useWorkspaceSessionDirectory', () => {
  it('loads and exposes Directory occupancy for one Workspace', async () => {
    const { result } = renderHook(() => useWorkspaceSessionDirectory('ws-1'))
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.directory?.workspace.id).toBe('ws-1')
    expect(result.current.directory?.sessions[0]?.resumeId).toBe('resume-ws-1')
    expect(result.current.error).toBeNull()
    expect(mocks.getWorkspaceSessionDirectory).toHaveBeenCalledWith('ws-1')
  })

  it('covers loading and error semantics for the selected desks', async () => {
    mocks.getWorkspaceSessionDirectory.mockRejectedValue(new Error('directory offline'))
    const { result } = renderHook(() => useWorkspaceSessionDirectories(['ws-1', 'ws-2']))

    await waitFor(() => expect(result.current.error).toBe('directory offline'))
    expect(result.current.directories.size).toBe(0)

    mocks.getWorkspaceSessionDirectory.mockImplementation(async (workspaceId: string) =>
      directory(workspaceId))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.error).toBeNull()
    expect([...result.current.directories.keys()]).toEqual(['ws-1', 'ws-2'])
  })

  it('does not fetch while no Workspace is in view', async () => {
    const { result } = renderHook(() => useWorkspaceSessionDirectories([]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.directories.size).toBe(0)
    expect(mocks.getWorkspaceSessionDirectory).not.toHaveBeenCalled()
  })
})
