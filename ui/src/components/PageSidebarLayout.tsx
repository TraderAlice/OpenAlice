import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { useRegisterMobilePageNavigation } from '../contexts/MobilePageNavigationContext'

const MIN_WIDTH = 200
const MAX_WIDTH = 420
const MAIN_PANE_MIN_WIDTH = 500
const COLLAPSED_WIDTH = 44
const RESIZE_HANDLE_WIDTH = 10
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

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
  const isAppDesktop = useIsDesktop(768)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mobileDrawerRef = useRef<HTMLDialogElement | null>(null)
  const mobileDrawerId = useId()
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
  const openMobileDrawer = useCallback(() => setDrawerOpen(true), [])
  const sidebarContent = typeof sidebar === 'function'
    ? sidebar({ closeMobileDrawer })
    : sidebar
  const usesAppContextBar = useRegisterMobilePageNavigation({
    title,
    controlsId: mobileDrawerId,
    expanded: drawerOpen,
    triggerRef: mobileTriggerRef,
    open: openMobileDrawer,
    close: closeMobileDrawer,
  }, !isAppDesktop && !isDesktop)

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
    if (isDesktop) return
    const drawer = mobileDrawerRef.current
    if (!drawer) return

    if (drawerOpen && !drawer.open) {
      if (typeof drawer.showModal === 'function') {
        drawer.showModal()
      } else {
        drawer.setAttribute('open', '')
      }
    } else if (!drawerOpen && drawer.open) {
      if (typeof drawer.close === 'function') {
        drawer.close()
      } else {
        drawer.removeAttribute('open')
      }
    }
  }, [drawerOpen, isDesktop])

  useEffect(() => {
    if (isDesktop || !drawerOpen) return
    const drawer = mobileDrawerRef.current
    if (!drawer) return

    const focusableElements = () =>
      Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.getAttribute('aria-hidden') !== 'true')

    const current = drawer.querySelector<HTMLElement>('[aria-current="page"]')
    const initialFocus = current?.matches(FOCUSABLE_SELECTOR)
      ? current
      : focusableElements()[0] ?? drawer
    initialFocus.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawerOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusables = focusableElements()
      if (focusables.length === 0) {
        event.preventDefault()
        drawer.focus({ preventScroll: true })
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      mobileTriggerRef.current?.focus({ preventScroll: true })
    }
  }, [drawerOpen, isDesktop])

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
        <div
          data-testid="page-sidebar-desktop"
          data-state={collapsed ? 'collapsed' : 'expanded'}
          className="relative h-full min-h-0 shrink-0 overflow-hidden border-r border-border/80 bg-secondary transition-[width] duration-[var(--motion-slow)] [transition-timing-function:var(--motion-ease-out)] motion-reduce:transition-none"
          style={{ width: collapsed ? COLLAPSED_WIDTH : width + RESIZE_HANDLE_WIDTH }}
        >
          <div
            data-testid="page-sidebar-expanded"
            aria-hidden={collapsed}
            inert={collapsed ? true : undefined}
            className={`absolute inset-y-0 left-0 flex transition-opacity duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-standard)] motion-reduce:delay-0 motion-reduce:transition-none ${
              collapsed
                ? 'pointer-events-none opacity-0'
                : 'opacity-100 delay-[60ms]'
            }`}
            style={{ width: width + RESIZE_HANDLE_WIDTH }}
          >
            <div
              className="h-full min-h-0 shrink-0"
              style={{ width }}
            >
              {sidebarPanel}
            </div>
            <ResizeHandle width={width} maxWidth={maxWidth} onPointerDown={beginResize} />
          </div>
          <aside
            data-testid="page-sidebar-collapsed"
            aria-hidden={!collapsed}
            inert={!collapsed ? true : undefined}
            className={`absolute inset-y-0 left-0 flex shrink-0 flex-col items-center bg-secondary py-1.5 transition-opacity duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-standard)] motion-reduce:delay-0 motion-reduce:transition-none ${
              collapsed
                ? 'opacity-100 delay-[80ms]'
                : 'pointer-events-none opacity-0'
            }`}
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
        </div>
        <div className="min-h-0 min-w-0 flex flex-1 flex-col">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div
        aria-hidden={drawerOpen ? true : undefined}
        inert={drawerOpen ? true : undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        {!usesAppContextBar && (
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 bg-secondary/40 px-3">
            <button
              ref={mobileTriggerRef}
              type="button"
              onClick={openMobileDrawer}
              className="oa-icon-action flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t('common.openPanel', { title })}
              aria-expanded={drawerOpen}
              aria-controls={mobileDrawerId}
              aria-haspopup="dialog"
              title={title}
            >
              <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden />
            </button>
            <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{title}</span>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>

      <dialog
        ref={mobileDrawerRef}
        id={mobileDrawerId}
        data-testid="page-sidebar-drawer"
        data-state={drawerOpen ? 'open' : 'closed'}
        role="dialog"
        aria-label={title}
        aria-modal={drawerOpen ? true : undefined}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen ? true : undefined}
        tabIndex={-1}
        className="oa-page-sidebar-dialog fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-[280px] max-w-[85vw] overflow-hidden border-0 bg-transparent p-0 text-foreground outline-none"
        onCancel={(event) => {
          event.preventDefault()
          setDrawerOpen(false)
        }}
        onClose={() => {
          if (drawerOpen) setDrawerOpen(false)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setDrawerOpen(false)
        }}
      >
        <Sidebar
          title={title}
          actions={actions}
          leading={
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="oa-icon-action -ml-2 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t('common.closePanel', { title })}
            >
              <X size={15} strokeWidth={1.75} aria-hidden />
            </button>
          }
        >
          {sidebarContent}
        </Sidebar>
      </dialog>
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
