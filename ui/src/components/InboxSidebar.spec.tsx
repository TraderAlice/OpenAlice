// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxEntry } from '../api/inbox'
import { i18n } from '../i18n'
import { InboxSidebar } from './InboxSidebar'

const mocks = vi.hoisted(() => ({
  entries: [] as InboxEntry[],
  loading: false,
  selectedEntryId: 'inbox-1' as string | null,
  mode: 'workspace' as 'workspace' | 'time',
  workspaces: [] as Array<{ id: string; tag: string }>,
  markRead: vi.fn(),
  select: vi.fn(),
  setMode: vi.fn(),
}))

vi.mock('../live/inbox', () => ({
  inboxLive: {
    useStore: (selector: (state: { entries: InboxEntry[]; loading: boolean }) => unknown) =>
      selector({ entries: mocks.entries, loading: mocks.loading }),
  },
}))

vi.mock('../live/inbox-read', () => ({
  useInboxRead: (selector: (state: { markRead: typeof mocks.markRead }) => unknown) =>
    selector({ markRead: mocks.markRead }),
}))

vi.mock('../live/inbox-selection', () => ({
  useInboxSelection: (
    selector: (state: {
      selectedEntryId: string | null
      select: typeof mocks.select
    }) => unknown,
  ) => selector({
    selectedEntryId: mocks.selectedEntryId,
    select: mocks.select,
  }),
}))

vi.mock('../live/inbox-view-mode', () => ({
  useInboxViewMode: (
    selector: (state: {
      mode: 'workspace' | 'time'
      setMode: typeof mocks.setMode
    }) => unknown,
  ) => selector({ mode: mocks.mode, setMode: mocks.setMode }),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ workspaces: mocks.workspaces }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.entries = [{
    id: 'inbox-1',
    ts: Date.now(),
    workspaceId: 'workspace-1',
    workspaceLabel: 'old-desk',
    comments: 'Research is ready.',
  }]
  mocks.loading = false
  mocks.selectedEntryId = 'inbox-1'
  mocks.mode = 'workspace'
  mocks.workspaces = [{ id: 'workspace-1', tag: 'renamed-desk' }]
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InboxSidebar Workspace labels', () => {
  it.each(['workspace', 'time'] as const)(
    'uses the current Workspace tag in %s view',
    (mode) => {
      mocks.mode = mode

      render(<InboxSidebar />)

      expect(screen.getByText('renamed-desk')).toBeTruthy()
      expect(screen.queryByText('old-desk')).toBeNull()
    },
  )

  it('preserves the recorded label after the Workspace is gone', () => {
    mocks.workspaces = []

    render(<InboxSidebar />)

    expect(screen.getByText('old-desk')).toBeTruthy()
  })
})
