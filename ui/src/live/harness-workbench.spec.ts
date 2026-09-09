import { beforeEach, expect, it } from 'vitest'
import { useHarnessWorkbench as store } from './harness-workbench'
beforeEach(() => store.setState({ workspaces: {} }))
it('deduplicates files and preserves active content and width across collapse', () => {
  const s = store.getState()
  s.openTab('a', { id: 'files', kind: 'files' })
  s.openTab('a', { id: 'file:x', kind: 'file', path: 'x' })
  s.patch('a', { open: false, width: 62, sessionId: 'one' })
  s.openTab('a', { id: 'file:x', kind: 'file', path: 'x' })
  expect(store.getState().workspaces.a).toMatchObject({ open: true, active: 'file:x', width: 62, sessionId: 'one' })
  expect(store.getState().workspaces.a.tabs).toHaveLength(2)
})
it('isolates workspace state and chooses an adjacent tab when closing', () => {
  const s = store.getState()
  s.openTab('a', { id: 'files', kind: 'files' })
  s.openTab('a', { id: 'studio', kind: 'studio' })
  s.openTab('b', { id: 'files', kind: 'files' })
  s.closeTab('a', 'studio')
  expect(store.getState().workspaces.a.active).toBe('files')
  s.closeTab('a', 'files')
  expect(store.getState().workspaces.a).toMatchObject({ active: null, open: false })
  expect(store.getState().workspaces.b).toMatchObject({ active: 'files', open: true })
})
