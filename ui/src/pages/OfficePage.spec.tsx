// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficePage } from './OfficePage'

vi.mock('./OfficeRuntimeSection', () => ({
  OfficeRuntimeSection: () => <div>Office occupancy</div>,
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'chat-1', tag: 'chat' }],
    hasLoaded: true,
  }),
}))

vi.mock('../hooks/useOfficeFloor', () => ({
  useOfficeFloor: () => ({
    building: {
      lastSeq: 1,
      firstSeq: 1,
      offices: [{ workspace: { id: 'chat-1', tag: 'chat' }, employees: [] }],
    },
    loading: false,
    error: null,
    refresh: async () => undefined,
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (select: (state: { openOrFocus: () => void }) => unknown) =>
    select({ openOrFocus: vi.fn() }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(cleanup)

describe('OfficePage localization', () => {
  it('localizes the Office header and building description', () => {
    render(<OfficePage />)

    expect(screen.getByRole('heading', { name: '办公室' })).toBeTruthy()
    expect(screen.getByText('每个 Workspace 是一间办公室。所有办公室排在同一层，员工坐自己的工位。')).toBeTruthy()
    expect(screen.getByText('点一张桌子，查看这名员工。')).toBeTruthy()
    expect(screen.getByText('Office occupancy')).toBeTruthy()
  })
})
