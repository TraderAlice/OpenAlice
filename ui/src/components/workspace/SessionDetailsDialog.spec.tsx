// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import '../../i18n'
import { SessionDetailsDialog } from './SessionDetailsDialog'
import type { SessionRecord } from './api'
const mocks = vi.hoisted(() => ({ open: vi.fn(), refresh: vi.fn() }))
vi.mock('../../tabs/store', () => ({ useWorkspace: (select: (value: unknown) => unknown) => select({ openOrFocus: mocks.open }) }))
vi.mock('../../hooks/useSessionDetails', () => ({ useSessionDetails: () => ({
  loading: false, errors: [], refresh: mocks.refresh,
  entry: { createdBy: { kind: 'interactive' }, runtime: { credentialSource: 'native', model: 'model-a', reasoningEffort: 'high' } },
  executions: [{ executionId: 'run', requestedAt: 2000, startedAt: 3000, finishedAt: 4000, phase: 'ended', surface: 'terminal', origin: { kind: 'user', entry: 'session-resume' }, configuration: { credentialSource: 'native' } }],
  issues: { workspaces: [{ wsId: 'other-ws', issues: [{ id: 'assigned', title: 'Assigned work', assignee: '@resume', status: 'todo' }, { id: 'unrelated', title: 'Other work', assignee: '@someone', status: 'todo' }] }] },
}) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('separates timestamps and navigates to the assigned Issue in its actual Workspace', () => {
  const close = vi.fn()
  render(<SessionDetailsDialog record={{ id: 'record', wsId: 'ws', resumeId: 'resume', name: 'Session', agent: 'pi', createdAt: new Date(1000).toISOString(), lastActiveAt: new Date(5000).toISOString(), state: 'paused' } as SessionRecord} onClose={close} />)
  for (const label of ['Created', 'Last started', 'Last ended', 'Last active']) expect(screen.getByText(label)).toBeTruthy()
  expect(screen.getByText('model-a')).toBeTruthy()
  expect(screen.queryByText('Other work')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Assigned work · todo' }))
  expect(close).toHaveBeenCalledOnce()
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'issue-detail', params: { wsId: 'other-ws', id: 'assigned' } })
})
