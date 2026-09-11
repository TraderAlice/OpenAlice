// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { WorkspaceHarnessRedirect } from './WorkspaceHarnessRedirect'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(), setSidebar: vi.fn(),
  context: { workspaces: [{ id: 'opaque-id', tag: 'prediction-looking-name', template: 'chat' }], hasLoaded: true, listError: null as string | null, refresh: vi.fn() },
}))
vi.mock('../contexts/workspaces-context', () => ({ useWorkspaces: () => mocks.context }))
vi.mock('./store', () => ({ useWorkspace: (selector: (state: typeof mocks) => unknown) => selector(mocks) }))
beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.context.workspaces = [{ id: 'opaque-id', tag: 'prediction-looking-name', template: 'chat' }]
  mocks.context.hasLoaded = true
  mocks.context.listError = null
})
afterEach(cleanup)

it.each([['chat', 'chat'], ['auto-quant-v2', 'auto-quant'], ['auto-prediction', 'prediction']])('routes %s Sessions into their actual Harness', async (template, source) => {
  mocks.context.workspaces[0]!.template = template
  render(<WorkspaceHarnessRedirect spec={{ kind: 'workspace', params: { wsId: 'opaque-id', sessionId: 'native-session' } }} />)
  await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'workspace', params: { wsId: 'opaque-id', sessionId: 'native-session', source } }))
  expect(mocks.setSidebar).toHaveBeenCalledWith(source)
})

it('preserves file and return-Session identity', async () => {
  render(<WorkspaceHarnessRedirect spec={{ kind: 'file-viewer', params: { wsId: 'opaque-id', path: 'reports/one.md', returnSessionId: 'native-session' } }} />)
  await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'file-viewer', params: { wsId: 'opaque-id', path: 'reports/one.md', returnSessionId: 'native-session', source: 'chat' } }))
})

it('does not guess a Harness from the tag or mount the old global desk', () => {
  mocks.context.workspaces[0]!.template = 'unknown'
  render(<WorkspaceHarnessRedirect spec={{ kind: 'workspace', params: { wsId: 'opaque-id', sessionId: 'native-session' } }} />)
  expect(screen.getByRole('status').textContent).toContain('unavailable')
  expect(mocks.openOrFocus).not.toHaveBeenCalled()
  expect(mocks.setSidebar).not.toHaveBeenCalled()
})

it('waits for metadata and preserves errors instead of falling back to a global desk', () => {
  mocks.context.workspaces = []
  mocks.context.hasLoaded = false
  const view = render(<WorkspaceHarnessRedirect spec={{ kind: 'workspace', params: { wsId: 'opaque-id' } }} />)
  expect(screen.getByText('Loading…')).toBeTruthy()
  mocks.context.listError = 'Backend offline'
  view.rerender(<WorkspaceHarnessRedirect spec={{ kind: 'workspace', params: { wsId: 'opaque-id' } }} />)
  expect(screen.getByText('Backend offline')).toBeTruthy()
  expect(mocks.openOrFocus).not.toHaveBeenCalled()
})
