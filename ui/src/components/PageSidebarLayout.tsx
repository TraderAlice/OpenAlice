import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Sidebar } from './Sidebar'
import { useRegisterMobilePageNavigation } from '../contexts/MobilePageNavigationContext'

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
  actions?: ReactNode | ((controls: PageSidebarControls) => ReactNode)
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
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null)
  const widthPersistTimerRef = useRef<number | null>(null)
  const userResizeRef = useRef(false)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mobileDrawerRef = useRef<HTMLDivElement | null>(null)
  const mobileDrawerId = useId()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => readStoredCollapsed(storageKey))
  const collapsedRef = useRef(collapsed)
  const [preferredWidth, setPreferredWidth] = useState(() =>
    readStoredWidth(storageKey, clampWidth(defaultWidth, defaultWidth)),
  )
  const latestWidthRef = useRef(preferredWidth)
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0,
  )
  const maxWidth = responsiveMaxWidth(containerWidth)
  const width = Math.min(preferredWidth, maxWidth)
  const closeMobileDrawer = useCallback(() => setDrawerOpen(false), [])
  const openMobileDrawer = useCallback(() => setDrawerOpen(true), [])
  const controls = { closeMobileDrawer }
  const actionContent = typeof actions === 'function' ? actions(controls) : actions
  const sidebarContent = typeof sidebar === 'function'
    ? sidebar(controls)
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

  const commitPreferredWidth = useCallback((next: number) => {
    if (widthPersistTimerRef.current !== null) {
      window.clearTimeout(widthPersistTimerRef.current)
      widthPersistTimerRef.current = null
    }
    latestWidthRef.current = next
    setPreferredWidth(next)
    persistWidth(next)
  }, [persistWidth])

  const queuePreferredWidth = useCallback((next: number) => {
    latestWidthRef.current = next
    if (widthPersistTimerRef.current !== null) {
      window.clearTimeout(widthPersistTimerRef.current)
    }
    widthPersistTimerRef.current = window.setTimeout(() => {
      widthPersistTimerRef.current = null
      userResizeRef.current = false
      setPreferredWidth(next)
      persistWidth(next)
    }, 150)
  }, [persistWidth])

  const updateCollapsed = useCallback((next: boolean) => {
    if (collapsedRef.current === next) return
    collapsedRef.current = next
    setCollapsed(next)
    window.localStorage.setItem(collapsedStorageName(storageKey), next ? '1' : '0')
  }, [storageKey])

  const handleSidebarResize = useCallback((size: PanelSize) => {
    const nextCollapsed = size.inPixels <= COLLAPSED_WIDTH + 1
    if (userResizeRef.current) {
      updateCollapsed(nextCollapsed)
      if (!nextCollapsed) {
        queuePreferredWidth(clampWidth(size.inPixels, MIN_WIDTH))
      }
    }
  }, [queuePreferredWidth, updateCollapsed])

  const handleLayoutChanged = useCallback(() => {
    if (!userResizeRef.current) return
    const panel = sidebarPanelRef.current
    if (!panel || panel.isCollapsed()) return
    const nextWidth = clampWidth(panel.getSize().inPixels, MIN_WIDTH)
    commitPreferredWidth(nextWidth)
    userResizeRef.current = false
  }, [commitPreferredWidth])

  const finishUserResize = useCallback(() => {
    if (!userResizeRef.current) return
    const panel = sidebarPanelRef.current
    if (panel && !panel.isCollapsed()) {
      commitPreferredWidth(clampWidth(panel.getSize().inPixels, MIN_WIDTH))
    }
    userResizeRef.current = false
  }, [commitPreferredWidth])

  const collapseSidebar = useCallback(() => {
    updateCollapsed(true)
    sidebarPanelRef.current?.collapse()
  }, [updateCollapsed])

  const expandSidebar = useCallback(() => {
    const targetWidth = Math.min(latestWidthRef.current, maxWidth)
    updateCollapsed(false)
    sidebarPanelRef.current?.expand()
    sidebarPanelRef.current?.resize(targetWidth)
  }, [maxWidth, updateCollapsed])

  useLayoutEffect(() => {
    if (!isDesktop || !collapsed) return
    sidebarPanelRef.current?.collapse()
  }, [collapsed, isDesktop])

  useLayoutEffect(() => {
    if (!isDesktop || collapsed || userResizeRef.current) return
    sidebarPanelRef.current?.resize(Math.min(latestWidthRef.current, maxWidth))
  }, [collapsed, isDesktop, maxWidth])

  useEffect(() => () => {
    if (widthPersistTimerRef.current !== null) {
      window.clearTimeout(widthPersistTimerRef.current)
    }
  }, [])

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
      {actionContent}
      <button
        type="button"
        onClick={collapseSidebar}
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
      <ResizablePanelGroup
        id={`page-sidebar-${storageKey}`}
        elementRef={rootRef}
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
        resizeTargetMinimumSize={{ fine: 10, coarse: 28 }}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        <ResizablePanel
          id={`page-sidebar-${storageKey}-navigator`}
          panelRef={sidebarPanelRef}
          defaultSize={width}
          minSize={MIN_WIDTH}
          maxSize={maxWidth}
          collapsedSize={COLLAPSED_WIDTH}
          collapsible
          groupResizeBehavior="preserve-pixel-size"
          onResize={handleSidebarResize}
          className="h-full min-h-0 overflow-hidden bg-secondary"
        >
          <div
            data-testid="page-sidebar-desktop"
            data-state={collapsed ? 'collapsed' : 'expanded'}
            className="relative h-full min-h-0 w-full overflow-hidden bg-secondary"
          >
            <div
              data-testid="page-sidebar-expanded"
              aria-hidden={collapsed}
              inert={collapsed ? true : undefined}
              className={`absolute inset-0 transition-opacity duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-standard)] motion-reduce:delay-0 motion-reduce:transition-none ${
                collapsed
                  ? 'pointer-events-none opacity-0'
                  : 'opacity-100 delay-[60ms]'
              }`}
            >
              {sidebarPanel}
            </div>
            <aside
              data-testid="page-sidebar-collapsed"
              aria-hidden={!collapsed}
              inert={!collapsed ? true : undefined}
              className={`absolute inset-0 flex flex-col items-center bg-secondary py-1.5 transition-opacity duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-standard)] motion-reduce:delay-0 motion-reduce:transition-none ${
                collapsed
                  ? 'opacity-100 delay-[80ms]'
                  : 'pointer-events-none opacity-0'
              }`}
            >
              <button
                type="button"
                onClick={expandSidebar}
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
        </ResizablePanel>
        <ResizableHandle
          id={`page-sidebar-${storageKey}-handle`}
          aria-label={t('common.resizePanel', { title })}
          onPointerDown={() => {
            userResizeRef.current = true
          }}
          onPointerUp={finishUserResize}
          onPointerCancel={finishUserResize}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              userResizeRef.current = true
            }
          }}
          onKeyUp={finishUserResize}
          onBlur={finishUserResize}
          className="z-10 bg-border/80 transition-colors hover:bg-primary/50 active:bg-primary/70"
        />
        <ResizablePanel
          id={`page-sidebar-${storageKey}-content`}
          minSize={MAIN_PANE_MIN_WIDTH}
          groupResizeBehavior="preserve-relative-size"
          className="min-h-0 min-w-0"
        >
          <div className="flex h-full min-h-0 min-w-0 flex-col">{children}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
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

      <Sheet
        open={drawerOpen}
        onOpenChange={(open) => setDrawerOpen(open)}
      >
        <SheetContent
          ref={mobileDrawerRef}
          id={mobileDrawerId}
          data-testid="page-sidebar-drawer"
          side="left"
          role="dialog"
          aria-modal="true"
          aria-describedby={undefined}
          showCloseButton={false}
          className="oa-page-sidebar-dialog h-dvh max-h-none w-[280px] max-w-[85vw] gap-0 overflow-hidden border-0 bg-transparent p-0 text-foreground"
          initialFocus={() => {
            const drawer = mobileDrawerRef.current
            const current = drawer?.querySelector<HTMLElement>('[aria-current="page"]')
            const firstFocusable = drawer?.querySelector<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )
            return current ?? firstFocusable ?? drawer
          }}
          finalFocus={mobileTriggerRef}
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <Sidebar
            title={title}
            actions={actionContent}
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
        </SheetContent>
      </Sheet>
    </div>
  )
}
