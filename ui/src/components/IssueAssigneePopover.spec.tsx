// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { IssueAssigneePopover } from './IssueAssigneePopover'
const mocks = vi.hoisted(() => ({ open: vi.fn(), mutate: vi.fn(), update: vi.fn(), detail: vi.fn() }))
vi.mock('../hooks/useIssueDetail', () => ({ useIssueDetail: () => mocks.detail() }))
vi.mock('../hooks/useWorkspaceSessionDirectory', () => ({ useWorkspaceSessionDirectory: () => ({ directory: { sessions: [] }, loading: false, error: null }) }))
vi.mock('../contexts/workspaces-context', () => ({ useWorkspaces: () => ({ openHeadlessRun: mocks.open }) }))
vi.mock('../api/issues', () => ({ issuesApi: { update: mocks.update } }))
beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.detail.mockReturnValue({ data: { issue: { assignee: '@resume-owner', title: 'Work', when: { kind: 'every', every: '1h' } }, assigneeSession: { resumeId: 'resume-owner', state: 'ready', workspace: { id: 'actual-owner-workspace' }, displayName: 'Research session', agent: 'pi', runtime: { model: 'test-model', reasoningEffort: 'high' } } }, mutate: mocks.mutate })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('loads on demand and opens the authoritative owner in its own Workspace', async () => {
  const user = userEvent.setup()
  render(<IssueAssigneePopover wsId="issue-workspace" id="work" assignee="@resume-owner" />)
  expect(mocks.detail).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Assignee' }))
  expect(screen.getByText('test-model')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Open conversation' }))
  expect(mocks.open).toHaveBeenCalledWith('actual-owner-workspace', 'resume-owner', { title: 'Research session' })
})
it('uses the existing confirmation picker and keeps errors visible', async () => {
  const user = userEvent.setup()
  mocks.update.mockRejectedValue(new Error('Session is busy'))
  render(<IssueAssigneePopover wsId="issue-workspace" id="work" assignee="@resume-owner" />)
  await user.click(screen.getByRole('button', { name: 'Assignee' }))
  await user.click(screen.getAllByRole('button', { name: 'Assignee' }).at(-1)!)
  await user.click(screen.getByRole('button', { name: /New Session · each run/ }))
  await user.click(screen.getByRole('button', { name: 'Confirm assignment' }))
  expect(mocks.update).toHaveBeenCalledWith('issue-workspace', 'work', { assignee: '@new-each-run' })
  expect(mocks.mutate).not.toHaveBeenCalled()
})
it('applies only the server-returned assignment after confirmation', async () => {
  const user = userEvent.setup()
  const next = { issue: { assignee: '@new-each-run' } }
  mocks.update.mockResolvedValue(next)
  render(<IssueAssigneePopover wsId="issue-workspace" id="work" assignee="@resume-owner" />)
  await user.click(screen.getByRole('button', { name: 'Assignee' }))
  await user.click(screen.getAllByRole('button', { name: 'Assignee' }).at(-1)!)
  await user.click(screen.getByRole('button', { name: /New Session · each run/ }))
  expect(mocks.update).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm assignment' }))
  expect(mocks.mutate).toHaveBeenCalledWith(next)
  expect(screen.getAllByRole('button', { name: 'Assignee' })[0].getAttribute('aria-description')).toBe('New Session · each run')
})
it('does not offer a chat action for an unavailable owner', async () => {
  const user = userEvent.setup()
  mocks.detail.mockReturnValue({ data: { issue: { assignee: '@resume-missing' }, assigneeSession: { resumeId: 'resume-missing', state: 'missing' } }, mutate: mocks.mutate })
  render(<IssueAssigneePopover wsId="issue-workspace" id="work" assignee="@resume-owner" />)
  await user.click(screen.getByRole('button', { name: 'Assignee' }))
  expect(screen.queryByRole('button', { name: 'Open conversation' })).toBeNull()
})

it.each([
  ['@unassigned', 'Unassigned'],
  ['@human', 'Human'],
  ['@new-each-run', 'New Session · each run'],
  ['@new-then-resume', 'New Session · assign after first run'],
  ['@resume-owner', 'Signed Session · resume-owner'],
])('describes assignment %s without fetching Session details', (assignee, description) => {
  render(<IssueAssigneePopover wsId="issue-workspace" id="work" assignee={assignee} />)
  expect(screen.getByRole('button', { name: 'Assignee' }).getAttribute('aria-description')).toBe(description)
  expect(mocks.detail).not.toHaveBeenCalled()
})
