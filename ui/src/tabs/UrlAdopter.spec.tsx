// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UrlAdopter } from './UrlAdopter'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
}))

const emptyState = {
  tabs: {},
  tree: {
    kind: 'leaf' as const,
    group: { id: 'g1', tabIds: [], activeTabId: null },
  },
  openOrFocus: mocks.openOrFocus,
  setSidebar: mocks.setSidebar,
}

vi.mock('./store', () => {
  const useWorkspace = Object.assign(
    (selector: (state: typeof emptyState) => unknown) => selector(emptyState),
    { getState: () => emptyState },
  )
  return { useWorkspace }
})

vi.mock('./registry', () => ({
  getView: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('UrlAdopter file provenance', () => {
  it('restores an Ask Alice file deep link with its Session return context', async () => {
    render(
      <MemoryRouter initialEntries={[
        '/chat/workspaces/chat-1/view/research%2Fnote.md?sessionId=pi-crisp-granite-pencil',
      ]}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: {
        wsId: 'chat-1',
        path: 'research/note.md',
        source: 'chat',
        returnSessionId: 'pi-crisp-granite-pencil',
      },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('chat')
  })

  it('keeps legacy Workspace file deep links in Workspaces', async () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/workspace-1/view/README.md']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: { wsId: 'workspace-1', path: 'README.md' },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('workspaces')
  })
})
