import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Resizer } from './Resizer'

interface SidebarProps {
  /** Header title — shown at the top of the sidebar (e.g. "CHAT", "SETTINGS"). */
  title: string
  /** Optional action buttons rendered right-aligned in the header (e.g. "+ new"). */
  actions?: ReactNode
  /** Scrollable body content — usually the activity-specific navigator (channel list, file tree, etc.). */
  children: ReactNode
}

const STORAGE_KEY = 'openalice.sidebar.width'
const DEFAULT_WIDTH = 240
const MIN_WIDTH = 150
const MAX_WIDTH = 500

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function loadStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? clamp(parsed, MIN_WIDTH, MAX_WIDTH) : DEFAULT_WIDTH
}

/**
 * VS Code-style Side Bar — sits between the Activity Bar and the Editor area.
 * Hosts the activity-specific navigator (channel list, file tree, search results,
 * deploy panel, etc.). Desktop only — hidden on mobile.
 *
 * Performance note: during drag, width is updated **directly on the DOM ref**
 * (bypassing React) so heavy children like PushApprovalPanel don't re-render
 * 60+ times per second. State only commits on drag end (for localStorage
 * persistence and so the next mount picks it up).
 */
export function Sidebar({ title, actions, children }: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null)
  const [persistedWidth, setPersistedWidth] = useState(loadStoredWidth)
  const dragStartWidthRef = useRef(persistedWidth)

  // Persist whenever the committed width changes.
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(persistedWidth))
  }, [persistedWidth])

  const handleResize = useCallback((delta: number, phase: 'start' | 'move' | 'end') => {
    const aside = asideRef.current
    if (!aside) return
    if (phase === 'start') {
      // Capture the width at drag start. Read from DOM (authoritative during drag).
      dragStartWidthRef.current = aside.offsetWidth
    } else if (phase === 'move') {
      const next = clamp(dragStartWidthRef.current + delta, MIN_WIDTH, MAX_WIDTH)
      aside.style.width = `${next}px`
    } else if (phase === 'end') {
      // Commit the final DOM width back to React state so the next mount /
      // localStorage write reflects it.
      setPersistedWidth(aside.offsetWidth)
    }
  }, [])

  const handleReset = useCallback(() => {
    const aside = asideRef.current
    if (aside) aside.style.width = `${DEFAULT_WIDTH}px`
    setPersistedWidth(DEFAULT_WIDTH)
  }, [])

  return (
    <aside
      ref={asideRef}
      className="hidden md:flex h-full flex-col bg-bg-secondary shrink-0 relative"
      style={{ width: persistedWidth }}
    >
      <div className="flex items-center justify-between px-3 h-10 shrink-0">
        <h2 className="text-[13px] font-medium text-text">{title}</h2>
        {actions && <div className="flex items-center gap-0.5">{actions}</div>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>

      {/* Drag handle on the right edge. Visible only on hover/active. */}
      <Resizer
        direction="horizontal"
        onResize={handleResize}
        onReset={handleReset}
        className="absolute top-0 right-0 bottom-0 w-1 z-10"
      />
    </aside>
  )
}
