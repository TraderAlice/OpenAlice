// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useOfficeInboxDutyReturn } from './useOfficeInboxDutyReturn'

const { openOrFocusMock, setSidebarMock } = vi.hoisted(() => ({
  openOrFocusMock: vi.fn(),
  setSidebarMock: vi.fn(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: {
    openOrFocus: typeof openOrFocusMock
    setSidebar: typeof setSidebarMock
  }) => unknown) => selector({
    openOrFocus: openOrFocusMock,
    setSidebar: setSidebarMock,
  }),
}))

describe('useOfficeInboxDutyReturn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', window.location.href)
  })

  it.each([
    ['after an excursion reload', { usr: { officeExcursion: true } }],
    ['without retained history state', null],
  ])('opens the exact Office tab %s', (_scenario, historyState) => {
    window.history.replaceState(historyState, '', window.location.href)
    const { result } = renderHook(() => useOfficeInboxDutyReturn())

    act(() => result.current())

    expect(setSidebarMock).toHaveBeenCalledOnce()
    expect(setSidebarMock).toHaveBeenCalledWith('office')
    expect(openOrFocusMock).toHaveBeenCalledOnce()
    expect(openOrFocusMock).toHaveBeenCalledWith({ kind: 'office', params: {} })
    expect(setSidebarMock.mock.invocationCallOrder[0]).toBeLessThan(
      openOrFocusMock.mock.invocationCallOrder[0],
    )
  })
})
