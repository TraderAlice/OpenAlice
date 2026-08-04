// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

function ConfirmDialogHarness({
  onConfirm,
}: {
  onConfirm: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Remove workspace</button>
      {open && (
        <ConfirmDialog
          title="Remove workspace?"
          message="This cannot be undone."
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

describe('ConfirmDialog', () => {
  it('keeps its compact card within a narrow viewport', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialogHarness onConfirm={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Remove workspace' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Remove workspace?' })
    expect(dialog.className).toContain('w-[calc(100%-2rem)]')
    expect(dialog.className).toContain('max-w-[440px]')
  })

  it('focuses cancel, closes on Escape, and restores the opener', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialogHarness onConfirm={() => {}} />)

    const opener = screen.getByRole('button', { name: 'Remove workspace' })
    await user.click(opener)

    expect(screen.getByRole('alertdialog', { name: 'Remove workspace?' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('keeps the dialog open and disables actions while confirmation is pending', async () => {
    let resolveConfirm: (() => void) | undefined
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => {
      resolveConfirm = resolve
    }))
    const user = userEvent.setup()
    render(<ConfirmDialogHarness onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Remove workspace' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Working…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    resolveConfirm?.()
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(false)
    })
  })
})
