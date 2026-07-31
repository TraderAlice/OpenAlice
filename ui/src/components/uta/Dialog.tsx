import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'

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
      const initialFocus = initialFocusRef?.current ?? focusableElements(surface)[0] ?? surface
      initialFocus.focus()
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const previousFocus = restoreFocusRef.current
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [handleKeyDown, initialFocusRef])

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

  const viewportLayout = mobileFullscreen
    ? 'items-stretch p-0 sm:items-center sm:p-4'
    : 'items-center p-4'
  const surfaceLayout = mobileFullscreen
    ? 'h-full max-h-none max-w-none rounded-none border-x-0 sm:h-auto sm:max-h-[85vh] sm:max-w-[95vw] sm:rounded-xl sm:border-x'
    : 'max-h-[85vh] max-w-[95vw] rounded-xl'

  return (
    // z-[60] keeps dialogs above the mobile nav drawers (z-50).
    <div className={`fixed inset-0 z-[60] flex justify-center ${viewportLayout}`}>
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
        className={`oa-dialog-surface relative ${width || 'w-full sm:w-[560px]'} ${surfaceLayout} flex flex-col overflow-hidden border border-border bg-background shadow-2xl`}
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
