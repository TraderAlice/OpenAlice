import { useRef, type ReactNode, type RefObject } from 'react'

import {
  Dialog as DialogPrimitive,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** Generic modal dialog used by settings, Workspace, and UTA flows. */
export function Dialog({
  onClose,
  width,
  ariaLabel,
  mobileFullscreen = false,
  initialFocusRef,
  children,
}: {
  onClose: () => void
  width?: string
  ariaLabel: string
  mobileFullscreen?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  return (
    <DialogPrimitive
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        aria-modal="true"
        aria-describedby={undefined}
        showCloseButton={false}
        initialFocus={initialFocusRef}
        finalFocus={restoreFocusRef}
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          width || 'w-full sm:w-[560px]',
          mobileFullscreen
            ? 'h-full max-h-none max-w-none rounded-none sm:h-auto sm:max-h-[85vh] sm:max-w-[95vw] sm:rounded-2xl'
            : 'max-h-[85vh] max-w-[95vw] rounded-2xl',
        )}
      >
        <DialogTitle className="sr-only">{ariaLabel}</DialogTitle>
        {children}
      </DialogContent>
    </DialogPrimitive>
  )
}
