import { useRef, useState, type ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConfirmDialogProps {
  /** Modal title — short, action-oriented (e.g. "Delete channel"). */
  title: string
  /** Body text. ReactNode so callers can embed the affected entity name in bold. */
  message: ReactNode
  /** Confirm button label. Defaults to 'Delete' for the destructive case. */
  confirmLabel?: string
  /** Cancel button label. Defaults to 'Cancel'. */
  cancelLabel?: string
  /** Confirm button label while the async action runs. Defaults to 'Working…'. */
  workingLabel?: string
  /** Visual treatment of the confirm button. Defaults to 'danger'. */
  variant?: 'danger' | 'primary'
  /** Called on user confirm. May be async — the button shows a busy state until it resolves. */
  onConfirm: () => void | Promise<void>
  /** Called on cancel / Escape / backdrop click. */
  onClose: () => void
}

/**
 * Generic confirmation modal for destructive or otherwise irreversible work.
 * AlertDialog owns focus containment, Escape handling, scroll locking, and
 * focus return; this product wrapper owns wording, busy state, and button tone.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  workingLabel = 'Working…',
  variant = 'danger',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

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
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <AlertDialogContent
        className="w-[calc(100%-2rem)] max-w-[440px] gap-0 overflow-hidden p-0"
        initialFocus={cancelRef}
        finalFocus={restoreFocusRef}
      >
        <div className="border-b border-border px-5 py-4">
          <AlertDialogTitle className="text-[15px] font-semibold">
            {title}
          </AlertDialogTitle>
        </div>
        <AlertDialogDescription
          render={<div className="px-5 py-4 text-[13px] leading-relaxed text-foreground" />}
        >
          {message}
        </AlertDialogDescription>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <AlertDialogCancel ref={cancelRef} className="btn-secondary" disabled={busy}>
            {cancelLabel}
          </AlertDialogCancel>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={confirmClass}
          >
            {busy ? workingLabel : confirmLabel}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
