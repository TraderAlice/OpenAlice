// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { i18n } from '../i18n'
import type { IssueDetailIssue, IssuePatch } from '../api/issues'
import { IssueScheduleEditor } from './IssueScheduleEditor'

const issue: IssueDetailIssue = {
  id: 'scan', title: 'Scan', status: 'todo', priority: 'none', assignee: '@new-each-run', what: 'Scan',
  when: { kind: 'cron', cron: '*/15 * * * *', timezone: 'America/Los_Angeles' }, timeout: '30m',
} as IssueDetailIssue
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
function editor(onPatch = vi.fn(async (_patch: IssuePatch) => true), current = issue) {
  const view = render(<IssueScheduleEditor issue={current} saving={false} onPatch={onPatch}>Cadence</IssueScheduleEditor>)
  fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
  return { ...view, onPatch }
}
const cron = () => screen.getByRole('textbox', { name: 'Cron expression' }) as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement

describe('IssueScheduleEditor', () => {
  it('keeps drafts private, submits once, then reopens the authoritative saved values', async () => {
    const patch = vi.fn(async (_patch: IssuePatch) => true)
    function Harness() {
      const [current, setCurrent] = useState(issue)
      return <IssueScheduleEditor issue={current} saving={false} onPatch={async (next) => {
        await patch(next)
        setCurrent({ ...current, when: next.when ?? current.when, nextDueAtMs: 12345 })
        return true
      }}>Cadence</IssueScheduleEditor>
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    expect(save().disabled).toBe(true)
    fireEvent.change(cron(), { target: { value: '0 * * * *' } })
    expect(patch).not.toHaveBeenCalled()
    fireEvent.click(save())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(patch).toHaveBeenCalledExactlyOnceWith({ when: { kind: 'cron', cron: '0 * * * *', timezone: 'America/Los_Angeles' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    expect(cron().value).toBe('0 * * * *')
    expect(screen.getByRole('combobox', { name: 'Run timeout' }).textContent).toBe('30m')
  })
  it('retains the draft on failure and allows retry', async () => {
    const patch = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    editor(patch)
    fireEvent.change(cron(), { target: { value: '0 * * * *' } })
    fireEvent.click(save())
    expect(await screen.findByText('Could not save schedule. Your changes are still here.')).toBeTruthy()
    expect(cron().value).toBe('0 * * * *')
    fireEvent.click(save())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(patch).toHaveBeenCalledTimes(2)
  })
  it('cancels without writing and restores the saved value on reopen', async () => {
    const { onPatch } = editor()
    fireEvent.change(cron(), { target: { value: '0 * * * *' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    expect(cron().value).toBe('*/15 * * * *')
    expect(onPatch).not.toHaveBeenCalled()
  })
  it('requires confirmation on dismissal and keeps the draft when editing continues', async () => {
    const { onPatch } = editor()
    fireEvent.change(cron(), { target: { value: '0 * * * *' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(cron().value).toBe('0 * * * *')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onPatch).not.toHaveBeenCalled()
  })
  it('submits timeout-only changes without rewriting when', async () => {
    const { onPatch } = editor()
    await userEvent.click(screen.getByRole('combobox', { name: 'Run timeout' }))
    await userEvent.click(await screen.findByRole('option', { name: 'No limit' }))
    expect(onPatch).not.toHaveBeenCalled()
    fireEvent.click(save())
    await waitFor(() => expect(onPatch).toHaveBeenCalledExactlyOnceWith({ timeout: null }))
  })
  it('validates each actual schedule type and preserves draft fields across switches', async () => {
    const { onPatch } = editor()
    fireEvent.change(cron(), { target: { value: '0 0 * *' } })
    expect(save().disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Interval' }))
    const every = screen.getByRole('textbox', { name: 'Repeat interval' })
    fireEvent.change(every, { target: { value: '0m' } })
    expect(save().disabled).toBe(true)
    fireEvent.change(every, { target: { value: '5m30s' } })
    expect(screen.queryByRole('combobox', { name: 'Time zone' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Once' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Run at · ISO timestamp' }), { target: { value: '2026-10-03T09:00:00' } })
    expect(save().disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Run at · ISO timestamp' }), { target: { value: '2026-10-03T09:00:00-07:00' } })
    expect(save().disabled).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: 'Interval' }))
    expect((screen.getByRole('textbox', { name: 'Repeat interval' }) as HTMLInputElement).value).toBe('5m30s')
    fireEvent.click(save())
    await waitFor(() => expect(onPatch).toHaveBeenCalledExactlyOnceWith({ when: { kind: 'every', every: '5m30s' } }))
  })
  it('preserves a dirty draft on polling, blocks overwriting changed fields, and reloads explicitly', () => {
    const { rerender, onPatch } = editor()
    fireEvent.change(cron(), { target: { value: '0 * * * *' } })
    rerender(<IssueScheduleEditor issue={{ ...issue, timeout: '60m' }} saving={false} onPatch={onPatch}>Cadence</IssueScheduleEditor>)
    expect(cron().value).toBe('0 * * * *')
    expect(save().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    expect(cron().value).toBe('*/15 * * * *')
    expect(screen.getByRole('combobox', { name: 'Run timeout' }).textContent).toBe('60m')
    expect(onPatch).not.toHaveBeenCalled()
  })
  it('does not expose a generic cadence writer for connector desks', () => {
    render(<IssueScheduleEditor issue={{ ...issue, connectorDesk: 'telegram' }} saving={false} onPatch={vi.fn()}>Cadence</IssueScheduleEditor>)
    expect(screen.queryByRole('button', { name: 'Schedule settings' })).toBeNull()
    expect(screen.getByText(/Manage this phone desk/)).toBeTruthy()
  })
})
