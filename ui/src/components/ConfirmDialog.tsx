import { useState } from 'react'
import { Dialog } from './uta/Dialog'

interface ConfirmDialogProps {
  /** Modal title — short, action-oriented (e.g. "Delete channel"). */
  title: string
  /** Body text. ReactNode so callers can embed the affected entity name in bold. */
  message: React.ReactNode
  /** Confirm button label. Defaults to 'Delete' for the destructive case. */
  confirmLabel?: string
  /** Visual treatment of the confirm button. Defaults to 'danger'. */
  variant?: 'danger' | 'primary'
  /** Called on user confirm. May be async — the button shows a busy state until it resolves. */
  onConfirm: () => void | Promise<void>
  /** Called on cancel / Escape / backdrop click. */
  onClose: () => void
}

/**
 * Generic confirmation modal — intended for destructive or otherwise
 * irreversible actions (delete channel, delete UTA, drop watchlist, …).
 * Wraps the existing Dialog primitive with a fixed two-button layout.
 *
 * Async-aware: if `onConfirm` returns a promise, the confirm button
 * disables and shows "Working…" until the promise settles. The dialog
 * stays open during the call so callers don't have to coordinate close
 * timing — they just `onClose()` from their resolve / reject path
 * (typically by clearing the controlling state in the parent).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  variant = 'danger',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  const confirmClass = variant === 'danger' ? 'btn-danger' : 'btn-primary'

  return (
    <Dialog onClose={busy ? () => {} : onClose} width="w-[440px]">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      </div>
      <div className="px-5 py-4 text-[13px] text-foreground leading-relaxed">
        {message}
      </div>
      <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className={confirmClass}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
