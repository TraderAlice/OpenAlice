import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { Button } from './ui/button'

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
  fallbackFocusRef?: RefObject<HTMLElement | null>
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
  fallbackFocusRef,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const confirmationStarted = useRef(false)
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  const handleConfirm = async () => {
    setBusy(true)
    confirmationStarted.current = true
    try {
      await onConfirm()
    } catch (error) {
      confirmationStarted.current = false
      throw error
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          confirmationStarted.current = false
          onClose()
        }
      }}
    >
      <AlertDialogContent
        className="w-[calc(100%-2rem)] max-w-[440px] gap-0 p-0"
        initialFocus={cancelRef}
        finalFocus={() => confirmationStarted.current && fallbackFocusRef?.current
          ? fallbackFocusRef.current
          : restoreFocusRef.current?.isConnected ? restoreFocusRef.current : fallbackFocusRef?.current ?? false}
      >
        <div className="px-6 pt-6 pb-3">
          <AlertDialogTitle>
            {title}
          </AlertDialogTitle>
        </div>
        <AlertDialogDescription
          render={<div className="px-6 pb-6 text-sm leading-relaxed text-foreground" />}
        >
          {message}
        </AlertDialogDescription>
        <div className="flex justify-end gap-2 bg-secondary px-6 py-4">
          <AlertDialogCancel ref={cancelRef} variant="secondary" disabled={busy}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            variant={variant === 'danger' ? 'destructive' : 'default'}
          >
            {busy ? workingLabel : confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
