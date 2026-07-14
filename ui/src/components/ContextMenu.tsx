import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type ContextMenuItem =
  | {
      kind: 'item'
      label: string
      onClick: () => void
      disabled?: boolean
      /** Render the item in red — for destructive actions like Close. */
      danger?: boolean
    }
  | { kind: 'separator' }

interface ContextMenuProps {
  /** Viewport coordinates (e.g. mouse event clientX/clientY). */
  anchor: { x: number; y: number }
  items: ContextMenuItem[]
  /** Fired on item click, ESC, or click-outside. Caller clears anchor state. */
  onClose: () => void
}

/**
 * Generic right-click / context menu. Anchored to a viewport coord;
 * flips back inside the viewport if it would overflow the right or
 * bottom edge. Closes on ESC, click outside, or any item activation.
 *
 * Built to be called from TabStrip's onContextMenu handler today, but
 * the API is generic — any caller that has mouse coords and a list of
 * actions can mount it.
 */
export function ContextMenu({ anchor, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(anchor)

  // Adjust position so the menu stays inside the viewport. Runs after
  // mount when we can measure the rendered menu.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 4
    let x = anchor.x
    let y = anchor.y
    if (x + rect.width + margin > window.innerWidth) {
      x = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (y + rect.height + margin > window.innerHeight) {
      y = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    setPos({ x, y })
  }, [anchor])

  // Outside-click + ESC dismiss
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 60,
      }}
      className="oa-popover-enter min-w-[180px] py-1 bg-bg-secondary border border-border rounded-md shadow-xl"
    >
      {items.map((item, i) => {
        if (item.kind === 'separator') {
          return <div key={`sep-${i}`} className="my-1 border-t border-border/60" />
        }
        const disabled = item.disabled === true
        const colorClass = item.danger
          ? 'text-red hover:bg-red/10'
          : 'text-text hover:bg-bg-tertiary'
        return (
          <button
            key={`item-${i}`}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              item.onClick()
              onClose()
            }}
            className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
              disabled ? 'opacity-40 cursor-not-allowed' : colorClass
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
