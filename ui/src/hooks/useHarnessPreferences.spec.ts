// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferencesApi } from '../api/preferences'
import { useHarnessPreferences } from './useHarnessPreferences'

vi.mock('../api/preferences', () => ({
  DEFAULT_HARNESS_PREFERENCES: {
    showHeadlessBornSessions: false,
    showIssueAttachedSessions: false,
    showUnverifiedHarnessReleases: false,
  },
  preferencesApi: {
    getHarness: vi.fn(),
    saveHarness: vi.fn(),
  },
}))

describe('useHarnessPreferences', () => {
  beforeEach(() => {
    vi.mocked(preferencesApi.getHarness).mockReset()
    vi.mocked(preferencesApi.saveHarness).mockReset()
    vi.mocked(preferencesApi.getHarness).mockResolvedValue({ showHeadlessBornSessions: false, showIssueAttachedSessions: false, showUnverifiedHarnessReleases: false })
    vi.mocked(preferencesApi.saveHarness).mockImplementation(async (next) => next)
  })

  it('starts hidden and keeps that default while the preference loads', () => {
    vi.mocked(preferencesApi.getHarness).mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useHarnessPreferences())
    expect(result.current.loading).toBe(true)
    expect(result.current.preferences.showHeadlessBornSessions).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('loads and saves roster visibility without leaving a stale error', async () => {
    vi.mocked(preferencesApi.getHarness).mockResolvedValue({ showHeadlessBornSessions: true, showIssueAttachedSessions: true, showUnverifiedHarnessReleases: false })
    const { result } = renderHook(() => useHarnessPreferences())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.preferences.showHeadlessBornSessions).toBe(true)

    await act(async () => {
      await result.current.save({ showHeadlessBornSessions: false, showIssueAttachedSessions: false, showUnverifiedHarnessReleases: false })
    })
    expect(preferencesApi.saveHarness).toHaveBeenCalledWith({ showHeadlessBornSessions: false, showIssueAttachedSessions: false, showUnverifiedHarnessReleases: false })
    expect(result.current.preferences.showHeadlessBornSessions).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
