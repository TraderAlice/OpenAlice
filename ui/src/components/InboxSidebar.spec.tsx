// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxEntry } from '../api/inbox'
import { i18n } from '../i18n'
import {
  clearOfficeInboxDutyExcursion,
  rememberOfficeInboxDutyExcursion,
} from '../office/inbox-duty-excursion'
import { inboxUnreadDutyRegistration, type OfficeInboxDutyCandidate } from '../office/duty-registry'
import { InboxSidebar } from './InboxSidebar'

const mocks = vi.hoisted(() => ({
  entries: [] as InboxEntry[],
  loading: false,
  selectedEntryId: 'inbox-1' as string | null,
  mode: 'workspace' as 'workspace' | 'time',
  workspaces: [] as Array<{ id: string; tag: string; displayName?: string }>,
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

function officeInboxDuty(entry: InboxEntry): OfficeInboxDutyCandidate {
  return inboxUnreadDutyRegistration([{
    title: entry.comments ?? entry.docs?.[0]?.path ?? 'Inbox delivery',
    entry,
  }], 'ready').candidates[0] as OfficeInboxDutyCandidate
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  window.sessionStorage.clear()
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
  mocks.workspaces = [{ id: 'workspace-1', tag: 'renamed-desk', displayName: 'Research desk' }]
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

describe('InboxSidebar Workspace labels', () => {
  it.each(['workspace', 'time'] as const)(
    'uses the current Workspace display name in %s view',
    (mode) => {
      mocks.mode = mode

      render(<InboxSidebar />)

      expect(screen.getByText('Research desk')).toBeTruthy()
      expect(screen.queryByText('renamed-desk')).toBeNull()
      expect(screen.queryByText('old-desk')).toBeNull()
    },
  )

  it('preserves the recorded label after the Workspace is gone', () => {
    mocks.workspaces = []

    render(<InboxSidebar />)

    expect(screen.getByText('old-desk')).toBeTruthy()
  })

  it('makes the update primary and keeps Workspace provenance secondary in time view', () => {
    mocks.mode = 'time'

    render(<InboxSidebar />)

    const update = screen.getByText('Research is ready')
    const workspace = screen.getByText('Research desk')
    expect(update.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(update.className).toMatch(/font-(medium|semibold)/)
    expect(workspace.className).toContain('text-muted-foreground')
  })

  it('keeps entries without comments or attachments scannable', () => {
    mocks.mode = 'time'
    mocks.entries = [{ ...mocks.entries[0]!, comments: '', docs: [] }]

    render(<InboxSidebar />)

    expect(screen.getByText('Update without a summary')).toBeTruthy()
  })

  it('gives a long report a concise accessible name and an optional excerpt', () => {
    const omittedTail = 'TAIL_MARKER_THAT_MUST_NOT_BE_THE_ROW_NAME'
    mocks.mode = 'time'
    mocks.entries = [{
      ...mocks.entries[0]!,
      comments: [
        'Morning scan is in.',
        '',
        `VST led on datacenter-power flow, and the rest of the tape stayed quiet. ${omittedTail}`,
      ].join('\n'),
    }]

    render(<InboxSidebar />)

    const row = screen.getByRole('button', { name: /Morning scan is in/ })
    const accessibleName = row.getAttribute('aria-label') ?? ''
    expect(accessibleName).toContain('Morning scan is in')
    expect(accessibleName).toContain('Research desk')
    expect(accessibleName).toContain('Unread')
    expect(accessibleName).not.toContain(omittedTail)
    expect(accessibleName.length).toBeLessThan(160)
    expect(screen.getByText(/VST led on datacenter-power flow/)).toBeTruthy()
    expect(screen.queryByText(omittedTail)).toBeNull()
  })

  it('names attachment-only and empty pushes without using a body as the title', () => {
    mocks.mode = 'time'
    mocks.entries = [
      {
        id: 'inbox-docs',
        ts: Date.now(),
        workspaceId: 'workspace-1',
        comments: '',
        docs: [{ path: 'reports/close-report.md' }, { path: 'notes/context.txt' }],
      },
    ]

    render(<InboxSidebar />)

    const row = screen.getByRole('button', { name: /close-report\.md/ })
    expect(row.getAttribute('aria-label')).toContain('close-report.md')
    expect(row.getAttribute('aria-label')).toContain('+1 more')
    expect(screen.getByText('close-report.md · +1 more')).toBeTruthy()
    expect(screen.queryByText(/reports\/close-report/)).toBeNull()
  })
})

describe('InboxSidebar search', () => {
  it('filters both views by update content and provenance, then clears cleanly', async () => {
    const user = userEvent.setup()
    mocks.entries = [
      {
        id: 'inbox-1',
        ts: Date.now(),
        workspaceId: 'workspace-1',
        workspaceLabel: 'old-desk',
        comments: 'Research is ready.',
        origin: { kind: 'headless', agent: 'codex', resumeId: 'resume-research' },
      },
      {
        id: 'inbox-2',
        ts: Date.now() - 1000,
        workspaceId: 'workspace-2',
        workspaceLabel: 'macro-desk',
        comments: 'Macro alert published.',
        origin: { kind: 'headless', agent: 'opencode', resumeId: 'resume-macro' },
      },
    ]
    mocks.workspaces = [
      { id: 'workspace-1', tag: 'renamed-desk' },
      { id: 'workspace-2', tag: 'macro-desk' },
    ]

    render(<InboxSidebar />)

    const search = screen.getByRole('searchbox', { name: 'Search Inbox…' })
    await user.type(search, 'opencode')

    expect(screen.getByText('Macro alert published')).toBeTruthy()
    expect(screen.queryByText('Research is ready')).toBeNull()
    expect(screen.getByText('1 of 2 updates')).toBeTruthy()

    search.blur()
    fireEvent.keyDown(window, { key: 'j' })
    expect(mocks.select).toHaveBeenCalledWith('inbox-2')
    expect(mocks.markRead).toHaveBeenCalledWith('inbox-2')

    await user.clear(search)
    await user.type(search, 'nothing-here')
    expect(screen.getByText('No updates match “nothing-here”.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Clear Inbox search' }))
    expect(screen.getByText('Research is ready')).toBeTruthy()
    expect(screen.getByText('Macro alert published')).toBeTruthy()
    expect(screen.queryByText(/updates match/)).toBeNull()
  })
})

describe('InboxSidebar Office review selection', () => {
  it('restores the captured Office target before the ordinary newest-row default', async () => {
    const newest = mocks.entries[0]!
    const captured: InboxEntry = {
      ...newest,
      id: 'inbox-office-older-than-feed',
      ts: newest.ts - 10_000,
      comments: 'Exact older Office report.',
    }
    mocks.mode = 'time'
    mocks.selectedEntryId = null
    rememberOfficeInboxDutyExcursion({
      duty: officeInboxDuty(captured),
      purpose: 'review',
      phase: 'presented',
      shift: { position: 2, total: 4 },
    })

    render(<InboxSidebar />)

    await vi.waitFor(() => expect(mocks.select).toHaveBeenCalledWith(captured.id))
    expect(mocks.select).not.toHaveBeenCalledWith(newest.id)
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it.each(['away', 'presented', 'returned'] as const)(
    'does not auto-read the exact Office target while its %s checkpoint is active',
    async (phase) => {
      const user = userEvent.setup()
      const target = mocks.entries[0]!
      mocks.mode = 'time'
      mocks.selectedEntryId = 'another-entry'
      rememberOfficeInboxDutyExcursion({
        duty: officeInboxDuty(target),
        purpose: 'review',
        phase,
        shift: { position: 1, total: 2 },
      })

      render(<InboxSidebar />)
      await user.click(screen.getByRole('button', { name: /Research is ready/ }))

      expect(mocks.select).toHaveBeenCalledWith(target.id)
      expect(mocks.markRead).not.toHaveBeenCalled()
    },
  )

  it('keeps unrelated and post-excursion selections on ordinary auto-read semantics', async () => {
    const user = userEvent.setup()
    const target = mocks.entries[0]!
    const unrelated: InboxEntry = {
      id: 'inbox-2',
      ts: target.ts - 1,
      workspaceId: 'workspace-1',
      workspaceLabel: 'old-desk',
      comments: 'Unrelated update.',
    }
    mocks.entries = [target, unrelated]
    mocks.mode = 'time'
    mocks.selectedEntryId = target.id
    rememberOfficeInboxDutyExcursion({
      duty: officeInboxDuty(target),
      purpose: 'review',
      phase: 'presented',
      shift: { position: 1, total: 2 },
    })

    render(<InboxSidebar />)
    await user.click(screen.getByRole('button', { name: /Unrelated update/ }))
    expect(mocks.markRead).toHaveBeenCalledWith(unrelated.id)

    mocks.markRead.mockClear()
    clearOfficeInboxDutyExcursion()
    await user.click(screen.getByRole('button', { name: /Research is ready/ }))
    expect(mocks.markRead).toHaveBeenCalledWith(target.id)
  })
})
