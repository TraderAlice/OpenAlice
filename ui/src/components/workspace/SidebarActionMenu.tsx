import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Ellipsis } from 'lucide-react'

export interface SidebarActionMenuItem {
  label: string
  ariaLabel?: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
}

export function SidebarActionMenu({
  label,
  items,
}: {
  label: string
  items: readonly SidebarActionMenuItem[]
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'above' | 'below'>('below')
  const focusEdgeRef = useRef<'first' | 'last'>('first')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])

  const choosePlacement = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    let clippingParent: HTMLElement | null = trigger.parentElement
    while (clippingParent) {
      const overflow = getComputedStyle(clippingParent).overflowY
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden' || overflow === 'clip') break
      clippingParent = clippingParent.parentElement
    }

    const triggerRect = trigger.getBoundingClientRect()
    const bounds = clippingParent?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
    const estimatedHeight = items.length * 36 + 10
    const roomAbove = triggerRect.top - bounds.top
    const roomBelow = bounds.bottom - triggerRect.bottom
    setPlacement(roomBelow < estimatedHeight && roomAbove > roomBelow ? 'above' : 'below')
  }

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }))
  }

  useLayoutEffect(() => {
    if (!open) return
    const focusable = menuItems()
    const target = focusEdgeRef.current === 'last'
      ? focusable[focusable.length - 1]
      : focusable[0]
    focusEdgeRef.current = 'first'
    target?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }

    const focusable = menuItems()
    if (focusable.length === 0) return
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement)

    let next: number | null = null
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % focusable.length
    if (event.key === 'ArrowUp') next = current <= 0 ? focusable.length - 1 : current - 1
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = focusable.length - 1
    if (next === null) return

    event.preventDefault()
    focusable[next]?.focus({ preventScroll: true })
  }

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        className="oa-icon-action oa-workspace-row-action flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          focusEdgeRef.current = 'first'
          setOpen((current) => {
            if (!current) choosePlacement()
            return !current
          })
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          focusEdgeRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
          choosePlacement()
          setOpen(true)
        }}
      >
        <Ellipsis size={14} strokeWidth={2.2} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`oa-popover-enter absolute right-0 z-30 w-[220px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border/70 bg-secondary py-1 shadow-lg ${
            placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              aria-label={item.ariaLabel}
              tabIndex={-1}
              className={`flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-muted ${
                item.danger ? 'text-destructive' : 'text-foreground'
              }`}
              onClick={() => {
                setOpen(false)
                item.onSelect()
                queueMicrotask(() => {
                  const active = document.activeElement
                  if (active === document.body || rootRef.current?.contains(active)) {
                    triggerRef.current?.focus({ preventScroll: true })
                  }
                })
              }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
