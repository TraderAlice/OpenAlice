// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import {
  readOfficeInboxDutyExcursion,
  rememberOfficeInboxDutyExcursion,
} from '../office/inbox-duty-excursion'
import { inboxUnreadDutyRegistration, type OfficeInboxDutyCandidate } from '../office/duty-registry'
import { FileViewerPage } from './FileViewerPage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
  selectTracked: vi.fn(),
  readWorkspaceFile: vi.fn(),
  workspaces: [] as Array<{ id: string; tag: string; displayName?: string }>,
  returnToOffice: vi.fn(),
}))

vi.mock('../office/useOfficeInboxDutyReturn', () => ({
  useOfficeInboxDutyReturn: () => mocks.returnToOffice,
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
  window.sessionStorage.clear()
  mocks.readWorkspaceFile.mockResolvedValue({ kind: 'ok', content: 'hello' })
  mocks.workspaces = [{
    id: 'chat-1',
    tag: 'chat-jul20',
    displayName: 'Semis and supply chain',
  }]
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

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
    expect(back.getAttribute('title')).toBeNull()
    expect(back.className).toContain('h-10')
    expect(back.className).toContain('w-10')
    expect(back.className).toContain('sm:h-8')
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
      params: { entity: 'stock-vst' },
    })
  })

  it('keeps the exact presented Office report escorted through its file viewer', () => {
    const duty = inboxUnreadDutyRegistration([{
      title: 'Weekly evidence report',
      entry: {
        id: 'inbox-weekly',
        ts: 42,
        workspaceId: 'chat-1',
        workspaceLabel: 'chat-jul20',
        docs: [{ path: 'research/note.md' }],
      },
    }], 'ready').candidates[0] as OfficeInboxDutyCandidate
    rememberOfficeInboxDutyExcursion({
      duty,
      purpose: 'review',
      phase: 'presented',
      shift: { position: 2, total: 4 },
    })

    render(
      <FileViewerPage
        spec={{
          kind: 'file-viewer',
          params: { wsId: 'chat-1', path: 'research/note.md', source: 'chat' },
        }}
      />,
    )

    expect(screen.getByRole('region', {
      name: /Office shift 2 of 4.*Weekly evidence report/,
    })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Return to Office' }))
    expect(mocks.returnToOffice).toHaveBeenCalledTimes(1)
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('presented')
  })
})
