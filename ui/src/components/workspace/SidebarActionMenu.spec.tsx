// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pencil, Trash2 } from 'lucide-react'

import { SidebarActionMenu } from './SidebarActionMenu'

afterEach(cleanup)

describe('SidebarActionMenu', () => {
  it('supports edge focus, arrow navigation, Escape, and focus return', async () => {
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
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })

    const rename = screen.getByRole('menuitem', { name: 'Rename' })
    const offboard = screen.getByRole('menuitem', { name: 'Offboard Research desk' })
    expect(offboard.textContent).toBe('Offboard workspace')
    expect(document.activeElement).toBe(offboard)

    fireEvent.keyDown(offboard, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rename)

    fireEvent.keyDown(rename, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on an outside pointer without invoking an action', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Session' }))
    expect(screen.getByRole('menuitem', { name: 'Delete Session' })).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
