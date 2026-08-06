// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Dialog } from './Dialog'

afterEach(cleanup)

function DialogHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      {open && (
        <Dialog ariaLabel="Example dialog" onClose={() => setOpen(false)}>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </Dialog>
      )}
    </>
  )
}

describe('Dialog modal behavior', () => {
  it('announces a named modal, contains keyboard focus, and restores the opener', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Example dialog' })
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Last action' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(first))

    await user.tab({ shift: true })
    await waitFor(() => expect(document.activeElement).toBe(last))
    await user.tab()
    await waitFor(() => expect(document.activeElement).toBe(first))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('offers a full mobile work area only when a long-form dialog opts in', () => {
    render(
      <Dialog ariaLabel="Long form" mobileFullscreen onClose={() => {}}>
        <button type="button">Action</button>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Long form' })
    expect(dialog.className).toContain('h-full')
    expect(dialog.className).toContain('sm:max-h-[85vh]')
    expect(dialog.className).toContain('sm:rounded-xl')
  })
})
