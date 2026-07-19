import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'

const MIN_WIDTH = 200
const MAX_WIDTH = 420
const MAIN_PANE_MIN_WIDTH = 500
const COLLAPSED_WIDTH = 44

function clampWidth(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)))
}

function storageName(storageKey: string): string {
  return `openalice.page-sidebar-width.${storageKey}.v1`
}

function collapsedStorageName(storageKey: string): string {
  return `openalice.page-sidebar-collapsed.${storageKey}.v1`
}

function readStoredWidth(storageKey: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(storageName(storageKey))
  if (!raw) return fallback
  return clampWidth(Number(raw), fallback)
}

function readStoredCollapsed(storageKey: string): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(collapsedStorageName(storageKey)) === '1'
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

function useIsDesktop(minWidth: number): boolean {
  const query = `(min-width: ${minWidth}px)`
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : true,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return matches
}

interface PageSidebarLayoutProps {
  storageKey: string
  title: string
  actions?: ReactNode
  sidebar: ReactNode | ((controls: PageSidebarControls) => ReactNode)
  children: ReactNode
  defaultWidth?: number
  /** Keep a page-specific navigator in a drawer below this viewport width. */
  desktopMinWidth?: number
}

export interface PageSidebarControls {
  /** Close the phone drawer after a business object is selected. No-op on desktop. */
  closeMobileDrawer: () => void
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
  desktopMinWidth = 768,
}: PageSidebarLayoutProps) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop(desktopMinWidth)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => readStoredCollapsed(storageKey))
  const [preferredWidth, setPreferredWidth] = useState(() =>
    readStoredWidth(storageKey, clampWidth(defaultWidth, defaultWidth)),
  )
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0,
  )
  const maxWidth = responsiveMaxWidth(containerWidth)
  const width = Math.min(preferredWidth, maxWidth)
  const closeMobileDrawer = useCallback(() => setDrawerOpen(false), [])
  const sidebarContent = typeof sidebar === 'function'
    ? sidebar({ closeMobileDrawer })
    : sidebar

  const persistWidth = useCallback((next: number) => {
    window.localStorage.setItem(storageName(storageKey), String(next))
  }, [storageKey])

  const updateCollapsed = useCallback((next: boolean) => {
    setCollapsed(next)
    window.localStorage.setItem(collapsedStorageName(storageKey), next ? '1' : '0')
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

  const desktopActions = (
    <>
      {actions}
      <button
        type="button"
        onClick={() => updateCollapsed(true)}
        className="oa-icon-action flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={t('common.collapsePanel', { title })}
        title={t('common.focusContent')}
      >
        <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden />
      </button>
    </>
  )

  const sidebarPanel = (
    <Sidebar title={title} actions={desktopActions}>
      {sidebarContent}
    </Sidebar>
  )

  if (isDesktop) {
    return (
      <div ref={rootRef} className="flex h-full min-h-0 w-full overflow-hidden">
        {collapsed ? (
          <aside
            className="flex h-full shrink-0 flex-col items-center border-r border-border/80 bg-secondary py-1.5"
            style={{ width: COLLAPSED_WIDTH }}
          >
            <button
              type="button"
              onClick={() => updateCollapsed(false)}
              className="oa-icon-action flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t('common.openPanel', { title })}
              title={t('common.openPanel', { title })}
            >
              <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <span
              aria-hidden
              className="mt-3 select-none text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground [writing-mode:vertical-rl] rotate-180"
            >
              {title}
            </span>
          </aside>
        ) : (
          <>
            <div
              className="h-full min-h-0 shrink-0"
              style={{ width }}
            >
              {sidebarPanel}
            </div>
            <ResizeHandle width={width} maxWidth={maxWidth} onPointerDown={beginResize} />
          </>
        )}
        <div className="min-h-0 min-w-0 flex flex-1 flex-col">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-secondary/40 px-3">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="oa-icon-action flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('common.openPanel', { title })}
          title={title}
        >
          <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden />
        </button>
        <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      <div
        className={`absolute inset-0 z-30 bg-backdrop transition-opacity duration-200 ${
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <div
        data-testid="page-sidebar-drawer"
        data-state={drawerOpen ? 'open' : 'closed'}
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
              className="text-muted-foreground hover:text-foreground p-1 -ml-1"
              aria-label={t('common.closePanel', { title })}
            >
              <X size={15} strokeWidth={1.75} aria-hidden />
            </button>
          }
        >
          {sidebarContent}
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
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-primary/50 group-active:bg-primary/70"
      />
    </div>
  )
}
