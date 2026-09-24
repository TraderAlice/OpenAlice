// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import '../../i18n'
import { RunningSessionGroup } from './RunningSessionGroup'
import type { HarnessSession } from './harness-sessions'
import { useSessionDetailsDialog } from './session-details-store'

afterEach(() => { cleanup(); vi.useRealTimers(); useSessionDetailsDialog.getState().close() })

it('shows a live duration from the active headless execution and keeps the row selectable', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-23T00:00:00.000Z'))
  const onSelect = vi.fn()
  const row = {
    resumeId: 'scan', title: 'Scan Open', session: { agent: 'claude' },
    directory: { latestExecution: { status: 'running', startedAt: Date.now() - 65_000 } },
  } as HarnessSession
  const view = render(<RunningSessionGroup sessions={[row]} onSelect={onSelect} />)
  fireEvent.click(screen.getByRole('button', { name: '1 running' }))
  expect(screen.getByRole('button', { name: 'Scan Open' }).getAttribute('aria-description')).toBe('Running for 1:05')
  act(() => vi.advanceTimersByTime(2_000))
  const running = screen.getByRole('button', { name: 'Scan Open' })
  expect(running.getAttribute('aria-description')).toBe('Running for 1:07')
  fireEvent.click(running)
  expect(onSelect).toHaveBeenCalledWith(row)
  view.rerender(<RunningSessionGroup sessions={[]} onSelect={onSelect} />)
  expect(screen.queryByRole('button', { name: /Scan Open/ })).toBeNull()
})

it('offers the standard hover action and opens this Session’s details', async () => {
  const user = userEvent.setup()
  const row = {
    resumeId: 'scan', title: 'Scan Open', session: { agent: 'claude', title: 'Old title' },
    directory: { latestExecution: { status: 'running', startedAt: Date.now() - 65_000 } },
  } as HarnessSession
  render(<RunningSessionGroup sessions={[row]} onSelect={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '1 running' }))
  const more = screen.getByRole('button', { name: 'More actions for Scan Open' })
  more.focus()
  await user.keyboard('{ArrowDown}')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }))
  await waitFor(() => expect(useSessionDetailsDialog.getState().record?.title).toBe('Scan Open'))
})
