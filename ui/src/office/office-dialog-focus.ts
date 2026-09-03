import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

const OFFICE_DIALOG_FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Shared keyboard loop for DOM-native Office game windows. */
export function trapOfficeDialogTab(event: ReactKeyboardEvent<HTMLElement>): void {
  const dialog = event.currentTarget
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(OFFICE_DIALOG_FOCUSABLE))
    .filter((element) => element.tabIndex >= 0
      && element.closest('[hidden], [aria-hidden="true"]') === null)
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement
  if (!dialog.contains(active)) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
