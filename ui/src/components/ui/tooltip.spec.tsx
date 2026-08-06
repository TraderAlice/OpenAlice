// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'

afterEach(cleanup)

function TooltipHarness() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger aria-label="Explains this control">?</TooltipTrigger>
        <TooltipContent>Explains this control</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

describe('Tooltip', () => {
  it('opens from pointer hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup()
    render(<TooltipHarness />)

    const trigger = screen.getByRole('button', { name: 'Explains this control' })
    await user.hover(trigger)
    await waitFor(() => expect(
      document.querySelector('[data-slot="tooltip-content"]')?.textContent,
    ).toContain('Explains this control'))

    await user.unhover(trigger)
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull())
  })

  it('opens for keyboard focus and closes on Escape without losing focus', async () => {
    const user = userEvent.setup()
    render(<TooltipHarness />)

    const trigger = screen.getByRole('button', { name: 'Explains this control' })
    await user.tab()
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(
      document.querySelector('[data-slot="tooltip-content"]')?.textContent,
    ).toContain('Explains this control'))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
