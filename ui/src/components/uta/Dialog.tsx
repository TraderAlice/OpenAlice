import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

/** Generic modal dialog used by the UTA wizard + edit flows. */
export function Dialog({ onClose, width, ariaLabel, children }: {
  onClose: () => void
  width?: string
  ariaLabel: string
  children: React.ReactNode
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    const surface = surfaceRef.current
    if (surface && !surface.contains(document.activeElement)) {
      const initialFocus = focusableElements(surface)[0] ?? surface
      initialFocus.focus()
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const previousFocus = restoreFocusRef.current
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [handleKeyDown])

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const surface = surfaceRef.current
    if (!surface) return

    const focusable = focusableElements(surface)
    if (focusable.length === 0) {
      event.preventDefault()
      surface.focus()
      return
    }

    const first = focusable[0]!
    const last = focusable.at(-1)!
    const active = document.activeElement
    if (event.shiftKey && (active === first || !surface.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !surface.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    // z-[60] keeps dialogs above the mobile nav drawers (z-50).
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        aria-hidden
        className="oa-dialog-backdrop absolute inset-0 bg-backdrop"
        onClick={onClose}
      />
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={`oa-dialog-surface relative ${width || 'w-full sm:w-[560px]'} max-w-[95vw] max-h-[85vh] bg-background rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden`}
      >
        {children}
      </div>
    </div>
  )
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => element.getAttribute('aria-hidden') !== 'true')
}
