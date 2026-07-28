// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { api } from '../api'
import { useInboxSelection } from '../live/inbox-selection'
import { readWorkspaceFile } from '../components/workspace/api'
import { InboxAttachment, InboxPage } from './InboxPage'

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [{
      id: 'ws-1',
      tag: 'research',
      sessions: [],
    }],
    openHeadlessRun: vi.fn(),
    resumeSession: vi.fn(),
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
})
