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
    expect(toggle.className).toContain('size-10')
    expect(toggle.className).toContain('-my-[9px]')

    const track = toggle.querySelector<HTMLElement>('[data-slot="switch-track"]')
    const thumb = toggle.querySelector<HTMLElement>('[data-slot="switch-thumb"]')
    expect(track?.getAttribute('aria-hidden')).toBe('true')
    expect(track?.className).toContain('w-10')
    expect(track?.className).toContain('h-[22px]')
    expect(track?.className).toContain('p-[3px]')
    expect(thumb?.className).toContain('size-4')
    expect(thumb?.className).toContain('data-checked:translate-x-[18px]')
    expect(thumb?.className).toContain('transition-[translate,background-color]')

    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('keeps the small visual track inside the same 40px hit target', () => {
    render(
      <Toggle
        ariaLabel="Enable compact tool"
        checked
        onChange={() => undefined}
        size="sm"
      />,
    )

    const toggle = screen.getByRole('switch', { name: 'Enable compact tool' })
    const track = toggle.querySelector<HTMLElement>('[data-slot="switch-track"]')
    const thumb = toggle.querySelector<HTMLElement>('[data-slot="switch-thumb"]')

    expect(toggle.className).toContain('size-10')
    expect(toggle.className).toContain('-mx-1')
    expect(toggle.className).toContain('-my-[11px]')
    expect(track?.className).toContain('w-8')
    expect(track?.className).toContain('h-[18px]')
    expect(thumb?.className).toContain('size-3')
    expect(thumb?.className).toContain('data-checked:translate-x-[14px]')
  })

  it('keeps native keyboard activation and a visible focus treatment', async () => {
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
    expect(toggle.className).toContain('focus-visible:[&_[data-slot=switch-track]]:ring-2')

    toggle.focus()
    await user.keyboard(' ')

    expect(document.activeElement).toBe(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
