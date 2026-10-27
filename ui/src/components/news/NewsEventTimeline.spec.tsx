import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { NewsEventTimeline } from './NewsEventTimeline'

afterEach(cleanup)
const development = (n: number) => ({ id: `step-${n}`, time: `2026-10-25T0${n}:00:00Z`, title: `Development ${n}`, summary: `Fact ${n}`, reportIds: [n, n + 10] })
describe('compact event timeline', () => {
  it('orders stored developments and opens only the selected evidence', async () => {
    await i18n.changeLanguage('en')
    const onEvidence = vi.fn()
    render(<NewsEventTimeline developments={[development(3), development(1), development(2)]} locale="en" onEvidence={onEvidence} />)
    const timeline = screen.getByRole('region', { name: 'Event timeline' })
    const buttons = within(timeline).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([expect.stringContaining('Development 1'), expect.stringContaining('Development 2'), expect.stringContaining('Development 3')])
    await userEvent.click(buttons[1])
    expect(onEvidence).toHaveBeenCalledWith([2, 12])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('keeps the first and latest records compact without inventing missing milestones', async () => {
    await i18n.changeLanguage('en')
    const { rerender } = render(<NewsEventTimeline developments={[1, 2, 3, 4, 5].map(development)} locale="en" onEvidence={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByText('Development 1')).toBeTruthy()
    expect(screen.getByText('Development 5')).toBeTruthy()
    expect(screen.getByText('2 more developments in details')).toBeTruthy()
    rerender(<NewsEventTimeline developments={[development(1)]} locale="en" onEvidence={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByText('Development 2')).toBeNull()
  })
})
