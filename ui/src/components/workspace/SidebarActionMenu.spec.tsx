// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pencil, Trash2 } from 'lucide-react'

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { ConfirmDialog } from '../ConfirmDialog'
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

    await user.keyboard('{ArrowUp}')
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

    const trigger = screen.getByRole('button', { name: 'More actions for Session' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Delete Session' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Outside' }))

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps a portalled menu interactive inside a modal Sheet', async () => {
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

    const trigger = screen.getByRole('button', { name: 'More actions for Session' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')

    const menu = screen.getByRole('menu', { name: 'More actions for Session' })
    expect(menu.hasAttribute('data-open')).toBe(true)
    expect(menu.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete Session' }))
  })

  it('hands focus to a follow-up dialog and restores the durable menu trigger', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [confirming, setConfirming] = useState(false)
      return (
        <>
          <SidebarActionMenu
            label="More actions for Session"
            items={[{
              label: 'Delete Session',
              icon: <Trash2 />,
              onSelect: () => setConfirming(true),
              danger: true,
            }]}
          />
          {confirming && (
            <ConfirmDialog
              title="Delete Session?"
              message="This cannot be undone."
              onConfirm={() => {}}
              onClose={() => setConfirming(false)}
            />
          )}
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'More actions for Session' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByRole('alertdialog', { name: 'Delete Session?' })).toBeTruthy())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
