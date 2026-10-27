import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import type { NewsAutomation } from '../../api/news'
import { NewsPreparation } from './NewsPreparation'

const mocks = vi.hoisted(() => ({ getAutomation: vi.fn(), setAutomation: vi.fn(), getProcessing: vi.fn(), getOriginal: vi.fn(), retryReport: vi.fn() }))
vi.mock('../../api', () => ({ api: { news: mocks } }))
const empty = { items: [], counts: { pending: 0, ready: 0, failed: 0, review: 0 }, nextOffset: null }
let automation: NewsAutomation
beforeEach(async () => {
  await i18n.changeLanguage('en')
  automation = { workspaces: [{ id: 'desk', tag: 'News desk' }], automations: [] }
  mocks.getAutomation.mockImplementation(async () => automation)
  mocks.getProcessing.mockResolvedValue(empty)
  mocks.setAutomation.mockImplementation(async (workspaceId, enabled) => {
    automation = { ...automation, automations: [{ workspaceId, enabled, scheduled: true, issueId: 'news-event-preparation', status: enabled ? 'todo' : 'canceled' }] }
    return automation
  })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
const mount = () => render(<MemoryRouter><NewsPreparation /></MemoryRouter>)

it('explains a customized prompt conflict and keeps its Issue available for review', async () => {
  const user = userEvent.setup()
  automation.automations = [{ workspaceId: 'desk', issueId: 'news-event-preparation', enabled: false, scheduled: true, status: 'canceled' }]
  mocks.setAutomation.mockRejectedValue(new Error('News preparation instructions require review. Open the Issue before enabling.'))
  mount()
  await screen.findByRole('option', { name: 'News desk' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Preparation Workspace' }), 'desk')
  await user.click(screen.getByRole('button', { name: 'Enable preparation' }))
  expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('news.preparationPromptReview'))
  expect(screen.getByRole('link', { name: 'View task and execution history' }).getAttribute('href')).toBe('/issues/desk/news-event-preparation')
})

it('requires a Workspace choice and exposes enable, pause and the actual Issue', async () => {
  const user = userEvent.setup()
  mount()
  const enable = screen.getByRole('button', { name: 'Enable preparation' })
  await screen.findByRole('option', { name: 'News desk' })
  expect(enable.hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(/Model charges may apply/)).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Preparation Workspace' }), 'desk')
  await user.click(enable)
  expect(mocks.setAutomation).toHaveBeenCalledWith('desk', true)
  const pause = await screen.findByRole('button', { name: 'Pause preparation' })
  expect(screen.getByRole('link', { name: 'View task and execution history' }).getAttribute('href')).toBe('/issues/desk/news-event-preparation')
  await user.click(pause)
  await waitFor(() => expect(mocks.setAutomation).toHaveBeenCalledWith('desk', false))
})

it('reads a held original before explicitly returning it to preparation', async () => {
  const user = userEvent.setup()
  const held = { id: 12, title: 'Port reopening report', source: 'Port authority', time: '2026-10-24T12:00:00Z', link: null, categories: null, processing: { status: 'review', reason: 'Check the actual port', attempts: 0 } }
  mocks.getProcessing.mockImplementation(async status => status === 'review' ? { ...empty, items: [held], counts: { ...empty.counts, review: 1 } } : empty)
  mocks.getOriginal.mockResolvedValue({ ...held, content: 'The eastern port reopened; the western port remains closed.' })
  mocks.retryReport.mockResolvedValue({ reportIds: [12], status: 'retry' })
  mount()
  await screen.findByRole('option', { name: 'News desk' })
  await user.click(screen.getByText('View preparation queue', { exact: false }))
  await user.click(screen.getByRole('button', { name: /Needs review/ }))
  expect(await screen.findByText('Check the actual port')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Read report' }))
  expect(await screen.findByRole('region', { name: 'Port reopening report' })).toHaveProperty('textContent', 'The eastern port reopened; the western port remains closed.')
  await user.type(screen.getByRole('textbox', { name: 'Review note (optional)' }), 'Check the eastern port event')
  await user.click(screen.getByRole('button', { name: 'Review and retry' }))
  await waitFor(() => expect(mocks.retryReport).toHaveBeenCalledWith(12, 'Check the eastern port event'))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('navigation', { name: 'Preparation queue' })))
})

it('keeps configuration unavailable when the authoritative status cannot be loaded', async () => {
  mocks.getAutomation.mockRejectedValue(new Error('offline'))
  mount()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Enable preparation' }).hasAttribute('disabled')).toBe(true)
  expect(mocks.setAutomation).not.toHaveBeenCalled()
})
