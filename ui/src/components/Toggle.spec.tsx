// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
