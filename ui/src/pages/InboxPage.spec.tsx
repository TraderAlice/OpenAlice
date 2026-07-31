// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { api } from '../api'
import { useInboxSelection } from '../live/inbox-selection'
import { readWorkspaceFile } from '../components/workspace/api'
import { InboxAttachment, InboxPage } from './InboxPage'

const workspaceMocks = vi.hoisted(() => ({
  openHeadlessRun: vi.fn(),
  resumeSession: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [{
      id: 'ws-1',
      tag: 'research',
      sessions: [],
    }],
    openHeadlessRun: workspaceMocks.openHeadlessRun,
    resumeSession: workspaceMocks.resumeSession,
  }),
}))

vi.mock('../hooks/useIssues', () => ({
  useIssues: () => ({ data: undefined }),
}))

vi.mock('../components/InboxReplyThread', () => ({
  InboxReplyThread: () => null,
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return { ...actual, readWorkspaceFile: vi.fn() }
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(readWorkspaceFile).mockResolvedValue({
    kind: 'ok',
    content: '<!doctype html><html><body><h1>Close report</h1></body></html>',
  })
})

afterEach(() => {
  cleanup()
  useInboxSelection.getState().select(null)
  vi.clearAllMocks()
})

describe('InboxAttachment', () => {
  it('keeps the collapsed state asset-like instead of leaking raw file content', async () => {
    render(
      <InboxAttachment
        workspaceId="ws-1"
        doc={{ path: 'research/close-report.html', revision: 'sha256:1234567890' }}
        defaultExpanded={false}
      />,
    )

    expect(await screen.findByText('HTML report')).toBeTruthy()
    expect(screen.getByText('close-report.html')).toBeTruthy()
    expect(screen.getByText('research')).toBeTruthy()
    expect(screen.queryByText(/doctype html/i)).toBeNull()
    expect(screen.queryByText(/sent 12345678/i)).toBeNull()
  })

  it('reveals the real viewer only after the attachment is opened', async () => {
    render(
      <InboxAttachment
        workspaceId="ws-1"
        doc={{ path: 'research/close-report.html' }}
        defaultExpanded={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview attachment close-report.html' }))

    expect(await screen.findByTitle('HTML report: research/close-report.html')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse attachment close-report.html' })).toBeTruthy()
  })

  it('keeps markdown asset actions touch-sized on mobile and compact on desktop', async () => {
    render(
      <InboxAttachment
        workspaceId="ws-1"
        doc={{ path: 'research/close-report.md' }}
        defaultExpanded={false}
      />,
    )

    const copy = await screen.findByRole('button', { name: 'Copy Markdown' })
    const download = screen.getByRole('button', { name: 'Download Markdown' })
    for (const action of [copy, download]) {
      expect(action.className).toContain('h-10')
      expect(action.className).toContain('w-10')
      expect(action.className).toContain('sm:h-7')
      expect(action.className).toContain('sm:w-7')
    }
  })
})

describe('InboxPage deletion', () => {
  it('requires confirmation for both the button and keyboard shortcut', async () => {
    const entry = {
      id: 'inbox-1',
      ts: Date.now(),
      workspaceId: 'ws-1',
      workspaceLabel: 'research',
      comments: 'A durable research update.',
    }
    vi.spyOn(api.inbox, 'history').mockResolvedValue({
      entries: [entry],
      hasMore: false,
    })
    const deleteEntry = vi.spyOn(api.inbox, 'delete').mockResolvedValue(true)
    useInboxSelection.getState().select(entry.id)

    render(<InboxPage visible />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete this inbox entry' }))
    expect(screen.getByText('Delete Inbox entry?')).toBeTruthy()
    expect(screen.getByText(/Files linked from research are not deleted/)).toBeTruthy()
    expect(deleteEntry).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete Inbox entry?')).toBeNull()
    expect(deleteEntry).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(screen.getByText('Delete Inbox entry?')).toBeTruthy()
    expect(deleteEntry).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith(entry.id))
    await waitFor(() => expect(screen.queryByText('Delete Inbox entry?')).toBeNull())
  })

  it('keeps the entry and confirmation available when deletion fails, then allows a retry', async () => {
    const entry = {
      id: 'inbox-retry',
      ts: Date.now(),
      workspaceId: 'ws-1',
      workspaceLabel: 'research',
      comments: 'Keep this update until the server confirms deletion.',
    }
    let serverHasEntry = true
    vi.spyOn(api.inbox, 'history').mockImplementation(async () => ({
      entries: serverHasEntry ? [entry] : [],
      hasMore: false,
    }))
    const deleteEntry = vi.spyOn(api.inbox, 'delete')
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockImplementationOnce(async () => {
        serverHasEntry = false
        return true
      })
    useInboxSelection.getState().select(entry.id)

    render(<InboxPage visible />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete this inbox entry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t delete this Inbox entry. It is still available. Try again.',
    )
    expect(screen.getByText(entry.comments)).toBeTruthy()
    expect(screen.getByText('Delete Inbox entry?')).toBeTruthy()
    expect(useInboxSelection.getState().selectedEntryId).toBe(entry.id)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteEntry).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Delete Inbox entry?')).toBeNull())
  })
})

describe('InboxPage responsive detail header', () => {
  it('keeps machine provenance on demand and mobile actions touch-sized', async () => {
    const entry = {
      id: 'inbox-mobile-header',
      ts: Date.now(),
      workspaceId: 'ws-1',
      workspaceLabel: 'research',
      comments: 'A durable research update.',
      origin: {
        kind: 'headless' as const,
        agent: 'pi',
        runId: 'run-mobile-header',
        resumeId: 'resume-plain-linen-river-2218b6',
        issueId: 'daily-us-market-close-with-a-long-name',
      },
    }
    vi.spyOn(api.inbox, 'history').mockResolvedValue({
      entries: [entry],
      hasMore: false,
    })
    useInboxSelection.getState().select(entry.id)

    render(<InboxPage visible />)

    const sender = await screen.findByRole('button', { name: 'Show sender details for pi' })
    expect(sender.textContent).toContain('from pi')
    expect(sender.textContent).not.toContain('resume-plain-linen-river-2218b6')
    expect(sender.className).toContain('min-h-10')
    expect(sender.className).toContain('sm:min-h-0')
    expect(screen.queryByText('@resume-plain-linen-river-2218b6')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open conversation' })).toBeNull()

    const issue = screen.getByRole('button', {
      name: 'from daily-us-market-close-with-a-long-name',
    })
    expect(issue.className).toContain('min-h-10')
    expect(issue.className).toContain('sm:min-h-0')

    fireEvent.click(sender)
    expect(screen.getByRole('dialog', {
      name: 'Sender identity: pi · @resume-plain-linen-river-2218b6',
    })).toBeTruthy()
    expect(screen.getByText('@resume-plain-linen-river-2218b6').className).toContain('break-all')
    const openConversation = screen.getByRole('button', { name: 'Open conversation' })
    expect(openConversation.className).toContain('min-h-10')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', {
      name: 'Sender identity: pi · @resume-plain-linen-river-2218b6',
    })).toBeNull()
    expect(document.activeElement).toBe(sender)

    fireEvent.click(sender)
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    await waitFor(() => expect(workspaceMocks.openHeadlessRun).toHaveBeenCalledWith(
      'ws-1',
      'resume-plain-linen-river-2218b6',
      { title: 'A durable research update.' },
    ))
    expect(screen.queryByRole('dialog', {
      name: 'Sender identity: pi · @resume-plain-linen-river-2218b6',
    })).toBeNull()

    const deleteEntry = screen.getByRole('button', { name: 'Delete this inbox entry' })
    expect(deleteEntry.className).toContain('h-10')
    expect(deleteEntry.className).toContain('w-10')
  })
})
