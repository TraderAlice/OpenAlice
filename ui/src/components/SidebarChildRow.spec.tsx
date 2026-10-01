import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SidebarChildRow, SidebarChildRowButton } from './SidebarChildRow'

afterEach(cleanup)

it('keeps the active destination and trailing actions independent', () => {
  const open = vi.fn()
  const options = vi.fn()
  render(<SidebarChildRow active>
    <SidebarChildRowButton icon={<svg />} onClick={open} aria-current="page">Studio</SidebarChildRowButton>
    <button onClick={options}>Options</button>
  </SidebarChildRow>)
  const main = screen.getByRole('button', { name: 'Studio' })
  expect(main.getAttribute('aria-current')).toBe('page')
  expect(main.parentElement?.dataset.active).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Options' }))
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(main)
  expect(open).toHaveBeenCalledOnce()
  expect(options).toHaveBeenCalledOnce()
})
