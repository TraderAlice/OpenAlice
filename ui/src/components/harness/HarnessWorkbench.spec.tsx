// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { HarnessWorkbench } from './HarnessWorkbench'
import { useHarnessWorkbench as store } from '../../live/harness-workbench'
import { i18n } from '../../i18n'
vi.mock('../../contexts/workspaces-context', () => ({ useWorkspaces: () => ({ agents: [] }) }))
vi.mock('../../hooks/useWorkspaceData', () => ({ useWorkspaceSessionData: () => ({ session: null }) }))
vi.mock('react-resizable-panels', () => ({ usePanelRef: () => ({ current: null }) }))
vi.mock('../ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}))
vi.mock('../workspace/FilesPanel', () => ({ FilesPanel: ({ onOpenFile }: { onOpenFile(path: string): void }) => <button onClick={() => onOpenFile('README.md')}>Read README</button> }))
vi.mock('../../pages/HarnessSurfacePage', () => ({ HarnessSurfacePage: () => <iframe title="Test Studio" /> }))
vi.mock('../../pages/WorkspacePage', () => ({ WorkspacePage: () => <div>Conversation library</div> }))
vi.mock('../../hooks/useWorkbenchFile', () => ({ useWorkbenchFile: () => ({ kind: 'ok', content: 'document' }) }))
vi.mock('../FileContentView', () => ({ FileContentView: () => <div>Document content</div> }))
beforeEach(async () => { store.setState({ workspaces: {} }); await i18n.changeLanguage('en') })
afterEach(cleanup)
it('retains the Studio node across tab selection and Session changes', () => {
  store.getState().openTab('a', { id: 'studio', kind: 'studio' })
  const { rerender } = render(<HarnessWorkbench source="auto-quant" spec={{ kind: 'workspace', params: { wsId: 'a', sessionId: 'one' } }}>First conversation</HarnessWorkbench>)
  const frame = screen.getByTitle('Test Studio')
  fireEvent.click(screen.getByRole('button', { name: 'Open in work panel' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Files' }))
  fireEvent.click(screen.getByRole('button', { name: 'Read README' }))
  expect(screen.getByText('Document content')).toBeTruthy()
  rerender(<HarnessWorkbench source="auto-quant" spec={{ kind: 'workspace', params: { wsId: 'a', sessionId: 'two' } }}>Second conversation</HarnessWorkbench>)
  expect(screen.getByTitle('Test Studio')).toBe(frame)
  expect(screen.getByRole('tab', { name: 'README.md' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Return to conversation / collapse panel' }))
  expect(store.getState().workspaces.a.open).toBe(false)
  expect(screen.getByTitle('Test Studio')).toBe(frame)
})
it('closes the addressed background tab without changing the selected document', () => {
  store.getState().openTab('a', { kind: 'files', id: 'files' })
  store.getState().openTab('a', { kind: 'file', id: 'file:README.md', path: 'README.md' })
  render(<HarnessWorkbench source="chat" spec={{ kind: 'workspace', params: { wsId: 'a' } }}>Conversation</HarnessWorkbench>)
  fireEvent.click(screen.getByRole('button', { name: 'Close Files' }))
  expect(screen.getByRole('tab', { name: 'README.md' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByRole('tab', { name: 'Files' })).toBeNull()
})

it('reopening a file refreshes its preview without adding another tab', () => {
  const tab = { kind: 'file' as const, id: 'file:report.md', path: 'report.md' }
  store.getState().openTab('a', tab)
  render(<HarnessWorkbench source="chat" spec={{ kind: 'workspace', params: { wsId: 'a' } }}>Conversation</HarnessWorkbench>)
  const previous = screen.getByText('Document content')
  act(() => store.getState().openTab('a', tab))
  expect(screen.getByText('Document content')).not.toBe(previous)
  expect(screen.getAllByRole('tab', { name: 'report.md' })).toHaveLength(1)
})
