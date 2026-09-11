// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAliceProject } from './useAliceProject'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  backendUnavailable: false,
  backendRecoveryGeneration: 0,
}))

vi.mock('../api', () => ({
  api: { aliceProject: { get: mocks.get } },
}))

vi.mock('../auth/AuthContext', () => ({
  useBackendRecoverySignal: () => ({
    backendUnavailable: mocks.backendUnavailable,
    backendRecoveryGeneration: mocks.backendRecoveryGeneration,
  }),
}))

const project = {
  id: 'alice-project-0123456789abcdef',
  key: 'research',
  displayName: 'Research AliceProject',
  home: '/tmp/research',
  appRoot: '/tmp/source',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mocks.backendUnavailable = false
  mocks.backendRecoveryGeneration = 0
  mocks.get.mockResolvedValue({ project })
  Reflect.deleteProperty(window, 'openAlice')
})

afterEach(() => {
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'openAlice')
})

describe('useAliceProject', () => {
  it('selects the browser-backed project with loading semantics', async () => {
    const { result } = renderHook(() => useAliceProject())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.project).toEqual(project)
    expect(result.current.error).toBeNull()
  })

  it('prefers the Electron runtime identity over HTTP', async () => {
    Object.defineProperty(window, 'openAlice', {
      configurable: true,
      value: { runtime: { info: vi.fn(async () => ({ aliceProject: project })) } },
    })
    const { result } = renderHook(() => useAliceProject())
    await waitFor(() => expect(result.current.project).toEqual(project))
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('reports errors and retries through the same domain boundary', async () => {
    mocks.get.mockRejectedValueOnce(new Error('backend offline'))
    const { result } = renderHook(() => useAliceProject())
    await waitFor(() => expect(result.current.error).toBe('backend offline'))

    await act(async () => { await result.current.refresh() })
    expect(result.current.project).toEqual(project)
    expect(result.current.error).toBeNull()
  })

  it('preserves the confirmed project during an outage and reloads it after recovery', async () => {
    const recoveredProject = {
      ...project,
      displayName: 'Recovered AliceProject',
      appRoot: '/tmp/recovered-source',
    }
    const { result, rerender } = renderHook(() => useAliceProject())
    await waitFor(() => expect(result.current.project).toEqual(project))

    mocks.backendUnavailable = true
    rerender()
    expect(result.current.project).toEqual(project)
    expect(result.current.loading).toBe(false)

    await act(async () => { await result.current.refresh() })
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(result.current.project).toEqual(project)

    mocks.get.mockResolvedValueOnce({ project: recoveredProject })
    mocks.backendUnavailable = false
    mocks.backendRecoveryGeneration = 1
    rerender()

    await waitFor(() => expect(result.current.project).toEqual(recoveredProject))
    expect(result.current.error).toBeNull()
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('ignores an old request that settles after the recovery refresh', async () => {
    const staleProject = { ...project, displayName: 'Stale AliceProject' }
    const recoveredProject = { ...project, displayName: 'Recovered AliceProject' }
    const stale = deferred<{ project: typeof project }>()
    const recovered = deferred<{ project: typeof project }>()
    const { result, rerender } = renderHook(() => useAliceProject())
    await waitFor(() => expect(result.current.project).toEqual(project))

    mocks.get.mockReturnValueOnce(stale.promise)
    let staleRefresh!: Promise<void>
    act(() => {
      staleRefresh = result.current.refresh()
    })
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))

    mocks.backendUnavailable = true
    rerender()
    expect(result.current.project).toEqual(project)

    mocks.get.mockReturnValueOnce(recovered.promise)
    mocks.backendUnavailable = false
    mocks.backendRecoveryGeneration = 1
    rerender()
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3))

    await act(async () => {
      recovered.resolve({ project: recoveredProject })
      await recovered.promise
    })
    await waitFor(() => expect(result.current.project).toEqual(recoveredProject))

    await act(async () => {
      stale.resolve({ project: staleProject })
      await staleRefresh
    })
    expect(result.current.project).toEqual(recoveredProject)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('does not expose the old owner project when the recovery read fails', async () => {
    const { result, rerender } = renderHook(() => useAliceProject())
    await waitFor(() => expect(result.current.project).toEqual(project))

    mocks.backendUnavailable = true
    rerender()
    expect(result.current.project).toEqual(project)

    mocks.get.mockRejectedValueOnce(new Error('recovered project read failed'))
    mocks.backendUnavailable = false
    mocks.backendRecoveryGeneration = 1
    rerender()

    expect(result.current.project).toBeNull()
    await waitFor(() => expect(result.current.error).toBe('recovered project read failed'))
    expect(result.current.project).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})
