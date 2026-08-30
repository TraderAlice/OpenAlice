// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficeReplayBar } from './OfficeReplayBar'

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('OfficeReplayBar', () => {
  it('scrubs seq and returns to live', async () => {
    const onAsOfSeq = vi.fn()
    const onViewFloor = vi.fn()
    const { rerender } = render(
      <OfficeReplayBar
        firstSeq={1}
        lastSeq={6}
        asOfSeq={2}
        onAsOfSeq={onAsOfSeq}
        onViewFloor={onViewFloor}
      />,
    )
    const slider = screen.getByRole('slider', { name: 'Replay' })
    expect(slider.getAttribute('aria-keyshortcuts'))
      .toBe('ArrowLeft ArrowRight ArrowUp ArrowDown Home End')
    expect(slider.style.getPropertyValue('--office-replay-progress')).toBe('20%')
    expect(slider.getAttribute('data-live')).toBe('false')
    expect(screen.getByText('Seq 2')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Previous replay event' }))
    expect(onAsOfSeq).toHaveBeenCalledWith(1)
    await userEvent.keyboard('{Enter}')
    expect(onAsOfSeq).toHaveBeenLastCalledWith(1)
    await userEvent.keyboard(' ')
    expect(onAsOfSeq).toHaveBeenLastCalledWith(1)
    await userEvent.click(screen.getByRole('button', { name: 'Next replay event' }))
    expect(onAsOfSeq).toHaveBeenCalledWith(3)
    slider.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onAsOfSeq).toHaveBeenLastCalledWith(1)
    await userEvent.keyboard('{ArrowRight}')
    expect(onAsOfSeq).toHaveBeenLastCalledWith(3)
    await userEvent.keyboard('{Home}')
    expect(onAsOfSeq).toHaveBeenLastCalledWith(1)
    await userEvent.keyboard('{End}')
    expect(onAsOfSeq).toHaveBeenLastCalledWith(null)
    fireEvent.change(slider, { target: { value: '3' } })
    expect(onAsOfSeq).toHaveBeenCalledWith(3)
    await userEvent.click(screen.getByRole('button', { name: 'View replay floor' }))
    expect(onViewFloor).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Enter}')
    expect(onViewFloor).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: 'Live' }))
    expect(onAsOfSeq).toHaveBeenCalledWith(null)

    rerender(
      <OfficeReplayBar
        firstSeq={1}
        lastSeq={6}
        asOfSeq={null}
        onAsOfSeq={onAsOfSeq}
        onViewFloor={onViewFloor}
      />,
    )
    expect(slider.style.getPropertyValue('--office-replay-progress')).toBe('100%')
    expect(slider.getAttribute('data-live')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Live' })).toBeNull()
    expect(screen.getByText('Live').closest('label')?.getAttribute('data-live')).toBe('true')
  })

  it('hides when the journal is empty', () => {
    render(
      <OfficeReplayBar
        firstSeq={0}
        lastSeq={0}
        asOfSeq={null}
        onAsOfSeq={vi.fn()}
        onViewFloor={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Replay')).toBeNull()
  })

  it('starts at the first retained journal sequence', () => {
    render(
      <OfficeReplayBar
        firstSeq={4}
        lastSeq={9}
        asOfSeq={1}
        onAsOfSeq={vi.fn()}
        onViewFloor={vi.fn()}
      />,
    )
    const slider = screen.getByLabelText('Replay')
    expect(slider.getAttribute('min')).toBe('4')
    expect(slider.getAttribute('value')).toBe('4')
    expect(slider.style.getPropertyValue('--office-replay-progress')).toBe('0%')
  })
})
