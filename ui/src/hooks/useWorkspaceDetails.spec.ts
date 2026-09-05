// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadFileResult, Workspace } from '../components/workspace/api'
import { useWorkspaceDetails } from './useWorkspaceDetails'

const mocks = vi.hoisted(() => ({
  read: vi.fn(), guide: vi.fn(),
  context: { workspaces: [] as Workspace[], templates: [{ name: 'chat', version: '9.0' }], hasLoaded: true, listError: null as string | null, refresh: vi.fn() },
}))
vi.mock('../contexts/workspaces-context', () => ({ useWorkspaces: () => mocks.context }))
vi.mock('./useHarnessPreferences', () => ({ useHarnessPreferences: () => ({ preferences: {} }) }))
vi.mock('./useWorkspaceSessionDirectory', () => ({ useWorkspaceSessionDirectory: () => ({ directory: null, loading: false, error: null }) }))
vi.mock('../components/workspace/api', async importOriginal => ({
  ...await importOriginal<typeof import('../components/workspace/api')>(),
  readWorkspaceFile: mocks.read, fetchTemplateReadme: mocks.guide,
}))

const workspace: Workspace = { id: 'one', tag: 'one', template: 'chat', dir: '/tmp/one', createdAt: '2026-09-05', sessions: [], currentVersion: '1.0' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.workspaces = [workspace, { ...workspace, id: 'two' }]
  mocks.context.hasLoaded = true
  mocks.context.listError = null
  mocks.read.mockResolvedValue({ kind: 'ok', content: '---\nversion: 1.0\n---\n# My workspace' })
  mocks.guide.mockResolvedValue('# Template guide')
})
afterEach(cleanup)

describe('useWorkspaceDetails', () => {
  it('keeps instance content and applied version separate from the catalog', async () => {
    const { result } = renderHook(() => useWorkspaceDetails('one', 'chat'))
    await waitFor(() => expect(result.current.readme).toEqual({ kind: 'ok', content: '# My workspace' }))
    expect(result.current.guide?.content).toBe('# Template guide')
    expect(result.current.workspace?.currentVersion).toBe('1.0')
    expect(result.current.template?.version).toBe('9.0')
    expect(mocks.read).toHaveBeenCalledWith('one', 'README.md')
  })

  it('does not fetch content for a Workspace belonging to a different Harness', () => {
    const { result } = renderHook(() => useWorkspaceDetails('one', 'prediction'))
    expect(result.current.workspace).toBeUndefined()
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.guide).not.toHaveBeenCalled()
  })

  it('keeps missing documents distinct from errors and allows retry', async () => {
    mocks.read.mockResolvedValueOnce({ kind: 'file_missing' })
    mocks.guide.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useWorkspaceDetails('one', 'chat'))
    await waitFor(() => expect(result.current.guide?.error).toBe('offline'))
    expect(result.current.readme?.kind).toBe('file_missing')
    act(() => result.current.retryDocuments())
    await waitFor(() => expect(result.current.guide?.content).toBe('# Template guide'))
    expect(result.current.readme?.kind).toBe('ok')
  })

  it('ignores a late previous Workspace response', async () => {
    let resolveOld!: (result: ReadFileResult) => void
    mocks.read.mockImplementationOnce(() => new Promise<ReadFileResult>(resolve => { resolveOld = resolve }))
    const { result, rerender } = renderHook(({ id }) => useWorkspaceDetails(id, 'chat'), { initialProps: { id: 'one' } })
    rerender({ id: 'two' })
    await waitFor(() => expect(result.current.readme?.kind).toBe('ok'))
    await act(async () => { resolveOld({ kind: 'ok', content: 'OLD' }) })
    expect(result.current.readme).toEqual({ kind: 'ok', content: '# My workspace' })
  })

  it('distinguishes initial loading from failed list retrieval', () => {
    mocks.context.workspaces = []
    mocks.context.hasLoaded = false
    const { result, rerender } = renderHook(() => useWorkspaceDetails('one', 'chat'))
    expect(result.current.loading).toBe(true)
    mocks.context.listError = 'Backend unavailable'
    rerender()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('Backend unavailable')
  })
})
