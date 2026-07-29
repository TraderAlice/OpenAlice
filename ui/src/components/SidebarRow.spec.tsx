// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarRow } from './SidebarRow'

afterEach(cleanup)

describe('SidebarRow current state', () => {
  it('exposes the active navigation destination to assistive technology', () => {
    render(
      <>
        <SidebarRow label="All accounts" active onClick={vi.fn()} />
        <SidebarRow label="Alpaca Paper" onClick={vi.fn()} />
      </>,
    )

    expect(screen.getByRole('button', { name: 'All accounts' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Alpaca Paper' }).getAttribute('aria-current')).toBeNull()
  })
})
