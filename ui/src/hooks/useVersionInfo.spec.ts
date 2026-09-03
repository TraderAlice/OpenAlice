// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  check: vi.fn(),
  recovery: {
    backendUnavailable: false,
    backendRecoveryGeneration: 0,
  },
}))

vi.mock('../api', () => ({
  api: { version: { get: mocks.get, check: mocks.check } },
}))

vi.mock('../auth/AuthContext', () => ({
  useBackendRecoverySignal: () => ({ ...mocks.recovery }),
}))

import type { VersionInfo } from '../api/types'
import { useVersionInfo } from './useVersionInfo'

function version(current: string): VersionInfo {
  return {
    current,
    channel: 'beta',
    updateAuthority: 'service',
    latest: current,
    hasUpdate: false,
    releaseUrl: `https://example.test/v${current}`,
    releaseNotes: null,
    publishedAt: null,
    error: null,
  }
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
  mocks.recovery.backendUnavailable = false
  mocks.recovery.backendRecoveryGeneration = 0
  mocks.get.mockResolvedValue(version('0.91.0-beta.2'))
  mocks.check.mockResolvedValue(version('0.91.0-beta.2'))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useVersionInfo', () => {
  it('loads passively and exposes explicit refresh and forced-check reads', async () => {
    const hook = renderHook(() => useVersionInfo())

    expect(hook.result.current.loading).toBe(true)
    await waitFor(() => expect(hook.result.current.info?.current).toBe('0.91.0-beta.2'))
    expect(hook.result.current.error).toBeNull()

    mocks.get.mockResolvedValueOnce(version('0.91.0-beta.3'))
    await act(async () => { await hook.result.current.refresh() })
    expect(hook.result.current.info?.current).toBe('0.91.0-beta.3')

    mocks.check.mockResolvedValueOnce(version('0.91.0-beta.4'))
    await act(async () => { await hook.result.current.check() })
    expect(hook.result.current.info?.current).toBe('0.91.0-beta.4')
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(mocks.check).toHaveBeenCalledOnce()
  })

  it('keeps the last confirmed snapshot when a refresh fails', async () => {
    const hook = renderHook(() => useVersionInfo())
    await waitFor(() => expect(hook.result.current.info?.current).toBe('0.91.0-beta.2'))

    mocks.get.mockRejectedValueOnce(new Error('version endpoint offline'))
    await act(async () => { await hook.result.current.refresh() })

    expect(hook.result.current.info?.current).toBe('0.91.0-beta.2')
    expect(hook.result.current.loading).toBe(false)
    expect(hook.result.current.error).toBe('version endpoint offline')
  })

  it('invalidates an outage request and ignores it after the recovered read wins', async () => {
    const stale = deferred<VersionInfo>()
    mocks.get.mockReturnValueOnce(stale.promise)
    const hook = renderHook(() => useVersionInfo())
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())

    mocks.recovery.backendUnavailable = true
    hook.rerender()
    expect(hook.result.current.loading).toBe(false)

    mocks.get.mockResolvedValueOnce(version('0.91.0-beta.3'))
    mocks.recovery.backendUnavailable = false
    mocks.recovery.backendRecoveryGeneration = 1
    hook.rerender()

    await waitFor(() => expect(hook.result.current.info?.current).toBe('0.91.0-beta.3'))
    expect(mocks.get).toHaveBeenCalledTimes(2)

    await act(async () => { stale.resolve(version('0.91.0-beta.2')) })
    expect(hook.result.current.info?.current).toBe('0.91.0-beta.3')
  })

  it('does not expose the old owner snapshot when the recovery read fails', async () => {
    const hook = renderHook(() => useVersionInfo())
    await waitFor(() => expect(hook.result.current.info?.current).toBe('0.91.0-beta.2'))

    mocks.recovery.backendUnavailable = true
    hook.rerender()
    expect(hook.result.current.info?.current).toBe('0.91.0-beta.2')

    mocks.get.mockRejectedValueOnce(new Error('recovered version read failed'))
    mocks.recovery.backendUnavailable = false
    mocks.recovery.backendRecoveryGeneration = 1
    hook.rerender()

    expect(hook.result.current.info).toBeNull()
    await waitFor(() => expect(hook.result.current.error).toBe('recovered version read failed'))
    expect(hook.result.current.info).toBeNull()
    expect(hook.result.current.loading).toBe(false)
  })

  it('aborts an in-flight manual check when the backend becomes unavailable', async () => {
    const hook = renderHook(() => useVersionInfo())
    await waitFor(() => expect(hook.result.current.info?.current).toBe('0.91.0-beta.2'))
    mocks.check.mockImplementationOnce((signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))

    let checking!: Promise<VersionInfo | null>
    act(() => { checking = hook.result.current.check() })
    await waitFor(() => expect(mocks.check).toHaveBeenCalledOnce())

    mocks.recovery.backendUnavailable = true
    hook.rerender()

    await expect(checking).resolves.toBeNull()
    expect(hook.result.current.loading).toBe(false)
    expect(hook.result.current.error).toBeNull()
  })

  it('waits for recovery instead of reading while mounted offline', async () => {
    mocks.recovery.backendUnavailable = true
    const hook = renderHook(() => useVersionInfo())

    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => {
      expect(await hook.result.current.refresh()).toBeNull()
      expect(await hook.result.current.check()).toBeNull()
    })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.check).not.toHaveBeenCalled()

    mocks.recovery.backendUnavailable = false
    mocks.recovery.backendRecoveryGeneration = 1
    hook.rerender()

    await waitFor(() => expect(hook.result.current.info?.current).toBe('0.91.0-beta.2'))
    expect(mocks.get).toHaveBeenCalledOnce()
  })
})
