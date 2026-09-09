import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SidebarChildRow, SidebarChildRowButton } from './SidebarChildRow'

afterEach(cleanup)

it('keeps destination and trailing actions independent with shared selection geometry', () => {
  const open = vi.fn()
  const options = vi.fn()
  render(<SidebarChildRow active>
    <SidebarChildRowButton icon={<svg />} onClick={open} aria-current="page">Studio</SidebarChildRowButton>
    <button onClick={options}>Options</button>
  </SidebarChildRow>)
  const main = screen.getByRole('button', { name: 'Studio' })
  expect(main.getAttribute('aria-current')).toBe('page')
  expect(main.parentElement?.dataset.active).toBe('true')
  expect(main.querySelector('span')?.className).toContain('size-4')
  fireEvent.click(screen.getByRole('button', { name: 'Options' }))
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(main)
  expect(open).toHaveBeenCalledOnce()
  expect(options).toHaveBeenCalledOnce()
})
