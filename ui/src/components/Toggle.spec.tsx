// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Toggle } from './Toggle'

afterEach(cleanup)

describe('Toggle', () => {
  it('exposes its purpose and checked state to assistive technology', () => {
    const onChange = vi.fn()
    render(
      <Toggle
        ariaLabel="Allow AI to push trades"
        checked={false}
        onChange={onChange}
      />,
    )

    const toggle = screen.getByRole('switch', { name: 'Allow AI to push trades' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.getAttribute('type')).toBe('button')

    const track = toggle.querySelector<HTMLElement>('[data-slot="switch-track"]')
    expect(track?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('keeps focus and native keyboard activation', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Toggle
        ariaLabel="Enable keyboard control"
        checked={false}
        onChange={onChange}
      />,
    )

    const toggle = screen.getByRole('switch', { name: 'Enable keyboard control' })

    toggle.focus()
    await user.keyboard(' ')

    expect(document.activeElement).toBe(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
