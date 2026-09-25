// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import '../../i18n'
import { SessionTakeoverDialogHost } from './SessionTakeoverDialog'
const mocks = vi.hoisted(() => ({ select: vi.fn(), decide: vi.fn(), open: vi.fn(), data: {} as any }))
vi.mock('../../hooks/useSessionTakeovers', () => ({ awaitingTakeover: (r: any) => ['pending','waiting-idle'].includes(r.state), useSessionTakeovers: () => mocks.data }))
vi.mock('../../tabs/store', () => ({ useWorkspace: (select: any) => select({ openOrFocus: mocks.open }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('separates dismissal from refusal and links to the requesting Issue', () => {
  mocks.data = { selected: 'request', select: mocks.select, decide: mocks.decide, offset: 0, idleSeconds: 60, requests: [{ id: 'request', workspaceId: 'target', sessionTitle: 'Research', requestedAt: Date.now(), deadline: Date.now()+60000, idleSeconds: 60, state: 'pending', origin: { kind: 'issue', entry: 'scheduled-issue', workspaceId: 'source', issueId: 'scan' } }] }
  render(<SessionTakeoverDialogHost />)
  expect(screen.getByText(/Research is currently open/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(mocks.select).toHaveBeenCalledWith(null)
  expect(mocks.decide).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Keep using Session' }))
  expect(mocks.decide).toHaveBeenCalledWith('request', 'reject')
  fireEvent.click(screen.getByRole('button', { name: 'View Issue' }))
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'issue-detail', params: { wsId: 'source', id: 'scan' } })
})
