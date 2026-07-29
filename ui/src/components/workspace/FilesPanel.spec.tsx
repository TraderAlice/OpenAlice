// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FilesPanel } from './FilesPanel'

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  openOrFocus: vi.fn(),
}))

vi.mock('./api', () => ({
  listFiles: mocks.listFiles,
}))

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listFiles.mockResolvedValue({
    path: '',
    entries: [{
      name: 'research.md',
      kind: 'file',
      sizeBytes: 128,
      mtime: '2026-07-20T00:00:00.000Z',
    }, {
      name: 'notes',
      kind: 'dir',
      sizeBytes: null,
      mtime: '2026-07-19T00:00:00.000Z',
    }, {
      name: 'workspace.sock',
      kind: 'other',
      sizeBytes: null,
      mtime: '2026-07-18T00:00:00.000Z',
    }],
  })
})

afterEach(cleanup)

describe('FilesPanel navigation provenance', () => {
  it('carries the Ask Alice Session into a file drill-in', async () => {
    render(
      <FilesPanel
        wsId="chat-1"
        sessionId="pi-crisp-granite-pencil"
        source="chat"
      />,
    )

    await waitFor(() => expect(screen.getByText('research.md')).toBeTruthy())
    fireEvent.click(screen.getByText('research.md'))

    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: {
        wsId: 'chat-1',
        path: 'research.md',
        source: 'chat',
        returnSessionId: 'pi-crisp-granite-pencil',
      },
    })
  })

  it('keeps a Workspace-level file drill-in source-neutral', async () => {
    render(<FilesPanel wsId="workspace-1" sessionId={null} />)

    await waitFor(() => expect(screen.getByText('research.md')).toBeTruthy())
    fireEvent.click(screen.getByText('research.md'))

    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: { wsId: 'workspace-1', path: 'research.md' },
    })
  })

  it('makes files and folders native keyboard controls while leaving other entries static', async () => {
    const user = userEvent.setup()
    render(<FilesPanel wsId="workspace-1" sessionId={null} />)

    const file = await screen.findByRole('button', { name: /research\.md/ })
    const folder = screen.getByRole('button', { name: /notes/ })
    expect(file.tagName).toBe('BUTTON')
    expect(file.tabIndex).toBe(0)
    expect(folder.tagName).toBe('BUTTON')
    expect(folder.tabIndex).toBe(0)
    expect(screen.getByText('workspace.sock').closest('button')).toBeNull()

    file.focus()
    await user.keyboard('{Enter}')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: { wsId: 'workspace-1', path: 'research.md' },
    })

    folder.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(mocks.listFiles).toHaveBeenCalledWith('workspace-1', 'notes'))
  })
})
