// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileViewerPage } from './FileViewerPage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
  readWorkspaceFile: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ workspaces: [{ id: 'chat-1', tag: 'chat-jul20' }] }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: {
    openOrFocus: typeof mocks.openOrFocus
    setSidebar: typeof mocks.setSidebar
  }) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
    setSidebar: mocks.setSidebar,
  }),
}))

vi.mock('../components/workspace/api', () => ({
  readWorkspaceFile: mocks.readWorkspaceFile,
}))

vi.mock('../components/FileContentView', () => ({
  FileContentView: () => <div>file content</div>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readWorkspaceFile.mockResolvedValue({ kind: 'ok', content: 'hello' })
})

afterEach(cleanup)

describe('FileViewerPage back navigation', () => {
  it('returns an Ask Alice artifact to the exact Session', () => {
    render(
      <FileViewerPage
        spec={{
          kind: 'file-viewer',
          params: {
            wsId: 'chat-1',
            path: 'research/note.md',
            source: 'chat',
            returnSessionId: 'pi-crisp-granite-pencil',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(mocks.setSidebar).toHaveBeenCalledWith('chat')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: {
        wsId: 'chat-1',
        sessionId: 'pi-crisp-granite-pencil',
        source: 'chat',
      },
    })
  })

  it('retains the existing generic Workspace fallback', () => {
    render(
      <FileViewerPage
        spec={{ kind: 'file-viewer', params: { wsId: 'chat-1', path: 'README.md' } }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(mocks.setSidebar).toHaveBeenCalledWith('workspaces')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'chat-1' },
    })
  })
})
