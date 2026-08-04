// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pencil, Trash2 } from 'lucide-react'

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SidebarActionMenu } from './SidebarActionMenu'

afterEach(cleanup)

describe('SidebarActionMenu', () => {
  it('supports edge focus, arrow navigation, Escape, and focus return', async () => {
    const user = userEvent.setup()
    const triggerLabel = 'More actions for Research desk'
    render(
      <SidebarActionMenu
        label={triggerLabel}
        items={[
          { label: 'Rename', icon: <Pencil />, onSelect: vi.fn() },
          {
            label: 'Offboard workspace',
            ariaLabel: 'Offboard Research desk',
            icon: <Trash2 />,
            onSelect: vi.fn(),
            danger: true,
          },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: triggerLabel })
    expect(trigger.className).toContain('oa-workspace-row-action')
    trigger.focus()
    await user.keyboard('{ArrowUp}')

    const rename = screen.getByRole('menuitem', { name: 'Rename' })
    const offboard = screen.getByRole('menuitem', { name: 'Offboard Research desk' })
    expect(offboard.textContent).toBe('Offboard workspace')
    expect(document.activeElement).toBe(offboard)

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rename)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on an outside pointer without invoking an action', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <>
        <SidebarActionMenu
          label="More actions for Session"
          items={[{ label: 'Delete Session', icon: <Trash2 />, onSelect, danger: true }]}
        />
        <button type="button">Outside</button>
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'More actions for Session' }))
    expect(screen.getByRole('menuitem', { name: 'Delete Session' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Outside' }))

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps its portal inside a modal Sheet boundary', async () => {
    const user = userEvent.setup()
    render(
      <Sheet open>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>Ask Alice</SheetTitle>
          <SidebarActionMenu
            label="More actions for Session"
            items={[{ label: 'Delete Session', icon: <Trash2 />, onSelect: vi.fn(), danger: true }]}
          />
        </SheetContent>
      </Sheet>,
    )

    await user.click(screen.getByRole('button', { name: 'More actions for Session' }))

    const sheet = screen.getByRole('dialog', { name: 'Ask Alice' })
    const menu = screen.getByRole('menu', { name: 'More actions for Session' })
    expect(sheet.contains(menu)).toBe(true)
    expect(menu.closest('[data-radix-popper-content-wrapper]')?.parentElement).toBe(sheet)
  })
})
