// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import { FileViewerPage } from './FileViewerPage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
  selectTracked: vi.fn(),
  readWorkspaceFile: vi.fn(),
  workspaces: [] as Array<{ id: string; tag: string; displayName?: string }>,
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ workspaces: mocks.workspaces }),
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

vi.mock('../live/tracked-selection', () => ({
  useTrackedSelection: (selector: (state: {
    select: typeof mocks.selectTracked
  }) => unknown) => selector({ select: mocks.selectTracked }),
}))

vi.mock('../components/FileContentView', () => ({
  FileContentView: () => <div>file content</div>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readWorkspaceFile.mockResolvedValue({ kind: 'ok', content: 'hello' })
  mocks.workspaces = [{
    id: 'chat-1',
    tag: 'chat-jul20',
    displayName: 'Semis and supply chain',
  }]
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

    const back = screen.getByRole('button', { name: 'Back to Semis and supply chain' })
    expect(back.getAttribute('title')).toBe('Back to Semis and supply chain')
    expect(back.className).toContain('h-10')
    expect(back.className).toContain('w-10')
    expect(back.className).toContain('sm:h-7')
    expect(screen.getByText('research/note.md').className).toContain('break-all')
    const workspaceIdentity = screen.getByText('Semis and supply chain')
    expect(workspaceIdentity.getAttribute('title')).toBe('Semis and supply chain\nchat-jul20')
    fireEvent.click(back)

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
    mocks.workspaces = [{ id: 'chat-1', tag: 'chat-jul20' }]

    render(
      <FileViewerPage
        spec={{ kind: 'file-viewer', params: { wsId: 'chat-1', path: 'README.md' } }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to chat-jul20' }))

    expect(mocks.setSidebar).toHaveBeenCalledWith('workspaces')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'chat-1' },
    })
  })

  it('returns a Tracked backlink artifact to the same entity context', () => {
    render(
      <FileViewerPage
        spec={{
          kind: 'file-viewer',
          params: {
            wsId: 'chat-1',
            path: 'research/power.md',
            source: 'tracked',
            returnTrackedName: 'stock-vst',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to Tracked' }))

    expect(mocks.selectTracked).toHaveBeenCalledWith('stock-vst')
    expect(mocks.setSidebar).toHaveBeenCalledWith('tracked')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'tracked',
      params: {},
    })
  })
})
