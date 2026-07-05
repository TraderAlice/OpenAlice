import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PanelLeftOpen, X } from 'lucide-react'
import { Sidebar } from './Sidebar'

const MIN_WIDTH = 200
const MAX_WIDTH = 420
const MAIN_PANE_MIN_WIDTH = 500

function clampWidth(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)))
}

function storageName(storageKey: string): string {
  return `openalice.page-sidebar-width.${storageKey}.v1`
}

function readStoredWidth(storageKey: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(storageName(storageKey))
  if (!raw) return fallback
  return clampWidth(Number(raw), fallback)
}

function responsiveMaxWidth(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return MAX_WIDTH
  const ratio =
    containerWidth < 900 ? 0.30 :
      containerWidth < 1180 ? 0.34 :
        0.36
  const proportional = Math.floor(containerWidth * ratio)
  const reserveMain = Math.floor(containerWidth - MAIN_PANE_MIN_WIDTH)
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, proportional, reserveMain))
}

function useIsDesktop(): boolean {
  const query = '(min-width: 768px)'
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : true,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return matches
}

interface PageSidebarLayoutProps {
  storageKey: string
  title: string
  actions?: ReactNode
  sidebar: ReactNode
  children: ReactNode
  defaultWidth?: number
}

/**
 * Page-owned left navigator. This is the migration path away from the global
 * ActivityBar-owned secondary sidebar: each route decides whether it needs a
 * local navigator, and owns its width + mobile drawer behavior.
 */
export function PageSidebarLayout({
  storageKey,
  title,
  actions,
  sidebar,
  children,
  defaultWidth = 260,
}: PageSidebarLayoutProps) {
  const isDesktop = useIsDesktop()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [preferredWidth, setPreferredWidth] = useState(() =>
    readStoredWidth(storageKey, clampWidth(defaultWidth, defaultWidth)),
  )
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0,
  )
  const maxWidth = responsiveMaxWidth(containerWidth)
  const width = Math.min(preferredWidth, maxWidth)

  const persistWidth = useCallback((next: number) => {
    window.localStorage.setItem(storageName(storageKey), String(next))
  }, [storageKey])

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = width
    let nextWidth = startWidth

    const onPointerMove = (moveEvent: PointerEvent) => {
      nextWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(startWidth + moveEvent.clientX - startX)))
      setPreferredWidth(nextWidth)
    }

    const onPointerUp = () => {
      persistWidth(nextWidth)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }, [maxWidth, persistWidth, width])

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false)
  }, [isDesktop])

  useEffect(() => {
    if (!isDesktop) return
    const el = rootRef.current
    if (!el) return

    const measure = () => {
      setContainerWidth(Math.round(el.getBoundingClientRect().width))
    }
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isDesktop])

  const sidebarPanel = (
    <Sidebar title={title} actions={actions}>
      {sidebar}
    </Sidebar>
  )

  if (isDesktop) {
    return (
      <div ref={rootRef} className="flex h-full min-h-0 w-full overflow-hidden">
        <div
          className="h-full min-h-0 shrink-0"
          style={{ width }}
        >
          {sidebarPanel}
        </div>
        <ResizeHandle width={width} maxWidth={maxWidth} onPointerDown={beginResize} />
        <div className="min-h-0 min-w-0 flex flex-1 flex-col">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-bg">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-bg-secondary/40 px-3">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-overlay hover:text-text"
          aria-label={`Open ${title}`}
          title={title}
        >
          <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden />
        </button>
        <span className="min-w-0 truncate text-[13px] font-semibold text-text">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      <div
        className={`absolute inset-0 z-30 bg-black/40 transition-opacity duration-200 ${
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <div
        className={`absolute inset-y-0 left-0 z-40 w-[280px] max-w-[85vw] transition-transform duration-200 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          title={title}
          actions={actions}
          leading={
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="text-text-muted hover:text-text p-1 -ml-1"
              aria-label={`Close ${title}`}
            >
              <X size={15} strokeWidth={1.75} aria-hidden />
            </button>
          }
        >
          {sidebar}
        </Sidebar>
      </div>
    </div>
  )
}

function ResizeHandle({
  width,
  maxWidth,
  onPointerDown,
}: {
  width: number
  maxWidth: number
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      className="group relative z-10 w-2.5 shrink-0 cursor-col-resize touch-none select-none bg-transparent"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-accent/50 group-active:bg-accent/70"
      />
    </div>
  )
}
