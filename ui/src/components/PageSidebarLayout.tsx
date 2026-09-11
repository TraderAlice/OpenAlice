import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { List, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Layout, PanelImperativeHandle, PanelSize } from 'react-resizable-panels'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Sidebar } from './Sidebar'
import { PageContentLayout } from './PageTopBar'
import { PrimaryNavigationContext } from '../contexts/PrimaryNavigationContext'
import { useRegisterMobilePageNavigation } from '../contexts/MobilePageNavigationContext'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const MIN_WIDTH = 200
const MAX_WIDTH = 420
const MAIN_PANE_MIN_WIDTH = 500
const RESIZE_SEPARATOR_WIDTH = 1
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

export function calculatePageSidebarConstraints(containerWidth: number): {
  navigatorMaxWidth: number
  contentMinWidth: number
} {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return {
      navigatorMaxWidth: MAX_WIDTH,
      contentMinWidth: 0,
    }
  }

  const panelBudget = Math.max(0, Math.floor(containerWidth) - RESIZE_SEPARATOR_WIDTH)
  const ratio =
    containerWidth < 900 ? 0.30 :
      containerWidth < 1180 ? 0.34 :
        0.36
  const proportional = Math.floor(containerWidth * ratio)
  const reserveMain = panelBudget - MAIN_PANE_MIN_WIDTH
  const navigatorMaxWidth = Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, proportional, reserveMain),
  )

  // The former flex layout reserved 500px for content only when the container
  // had enough room. Below that point the navigator kept its 200px minimum and
  // content received the remainder. Keep the two panel constraints feasible at
  // every desktop width instead of asking the resizable group to satisfy two
  // contradictory hard minimums.
  const contentMinWidth = Math.max(
    0,
    Math.min(MAIN_PANE_MIN_WIDTH, panelBudget - MIN_WIDTH),
  )

  return { navigatorMaxWidth, contentMinWidth }
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
  const primaryNavigation = useContext(PrimaryNavigationContext)
  const isDesktop = useIsDesktop(desktopMinWidth)
  const isAppDesktop = useIsDesktop(768)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const navigatorElementRef = useRef<HTMLDivElement | null>(null)
  const contentElementRef = useRef<HTMLDivElement | null>(null)
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null)
  const resizeHandleRef = useRef<HTMLDivElement | null>(null)
  const userResizeIntentRef = useRef(false)
  const userResizeChangedRef = useRef(false)
  const layoutRepairFrameRef = useRef<number | null>(null)
  const layoutRecoveryInFlightRef = useRef(false)
  const pointerGestureRef = useRef<number | null>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mobileDrawerRef = useRef<HTMLDivElement | null>(null)
  const mobileDrawerId = useId()
  const navigatorPanelId = `page-sidebar-${storageKey}-navigator`
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [preferredWidth, setPreferredWidth] = useState(() =>
    readStoredWidth(storageKey, clampWidth(defaultWidth, defaultWidth)),
  )
  const latestWidthRef = useRef(preferredWidth)
  // Keep registration inputs stable during a held resize; recovery explicitly
  // rebuilds the group from the last valid user width.
  const groupDefaultSizeRef = useRef(preferredWidth)
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  // The page-owned group is narrower than window.innerWidth because the app
  // rail remains outside it. Wait for the real group measurement before
  // applying responsive constraints; using the viewport here can briefly make
  // the panel minimums impossible and poison the group's restored layout.
  const [containerWidth, setContainerWidth] = useState(0)
  const {
    navigatorMaxWidth: maxWidth,
    contentMinWidth,
  } = calculatePageSidebarConstraints(containerWidth)
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
    latestWidthRef.current = next
    setPreferredWidth(next)
    persistWidth(next)
  }, [persistWidth])

  const hasInvalidExpandedLayout = useCallback(() => {
    const root = rootRef.current
    const navigator = navigatorElementRef.current
    const content = contentElementRef.current
    const groupWidth = root?.getBoundingClientRect().width ?? 0
    if (
      !root ||
      !navigator ||
      !content ||
      groupWidth <= RESIZE_SEPARATOR_WIDTH ||
      pointerGestureRef.current !== null ||
      layoutRecoveryInFlightRef.current
    ) return false

    // Read painted geometry rather than the imperative Panel size. During a
    // registration race the library's layout store and ARIA metadata can be
    // valid while the flex styles left on the DOM are still 100% / 0%.
    const currentWidth = navigator.getBoundingClientRect().width
    const currentContentWidth = content.getBoundingClientRect().width
    return currentWidth > maxWidth + 1 ||
      currentContentWidth < contentMinWidth - 1 ||
      currentWidth < MIN_WIDTH - 1
  }, [contentMinWidth, maxWidth])

  const scheduleExpandedLayoutRepair = useCallback(() => {
    if (
      layoutRepairFrameRef.current !== null ||
      !hasInvalidExpandedLayout()
    ) return
    layoutRepairFrameRef.current = window.requestAnimationFrame(() => {
      layoutRepairFrameRef.current = null
      if (!hasInvalidExpandedLayout()) return

      // A second resize request may be ignored when the internal layout already
      // equals the desired size. Rebuild the primitive group instead so its DOM
      // styles are derived from one coherent registration snapshot.
      layoutRecoveryInFlightRef.current = true
      groupDefaultSizeRef.current = Math.min(latestWidthRef.current, maxWidth)
      setLayoutEpoch((current) => current + 1)
    })
  }, [hasInvalidExpandedLayout, maxWidth])

  useLayoutEffect(() => {
    layoutRecoveryInFlightRef.current = false
  }, [layoutEpoch])

  const handleSidebarResize = useCallback((size: PanelSize) => {
    const groupWidth = rootRef.current?.getBoundingClientRect().width ?? 0
    const logicalPixels = groupWidth > RESIZE_SEPARATOR_WIDTH && Number.isFinite(size.asPercentage)
      ? ((groupWidth - RESIZE_SEPARATOR_WIDTH) * size.asPercentage) / 100
      : size.inPixels
    if (groupWidth > RESIZE_SEPARATOR_WIDTH && (
      logicalPixels < MIN_WIDTH - 1 ||
      logicalPixels > maxWidth + 1 ||
      groupWidth - RESIZE_SEPARATOR_WIDTH - logicalPixels < contentMinWidth - 1
    )) scheduleExpandedLayoutRepair()
    if (userResizeIntentRef.current) {
      userResizeChangedRef.current = true
    }
  }, [contentMinWidth, maxWidth, scheduleExpandedLayoutRepair])

  const handleLayoutChanged = useCallback((layout: Layout) => {
    const panel = sidebarPanelRef.current
    if (!panel) return

    const groupWidth = rootRef.current?.getBoundingClientRect().width ?? 0
    const percentage = layout[navigatorPanelId]
    const settledPixels = groupWidth > RESIZE_SEPARATOR_WIDTH && Number.isFinite(percentage)
      ? ((groupWidth - RESIZE_SEPARATOR_WIDTH) * percentage) / 100
      : panel.getSize().inPixels

    // react-resizable-panels re-registers a Panel when a pixel constraint
    // changes. During that registration window it can briefly settle a
    // one-panel layout at 100%, even though the rebuilt separator still
    // advertises the correct max. Never persist that impossible geometry.
    // Restore the product preference after registration has settled instead.
    const invalidExpandedLayout = (
      settledPixels < MIN_WIDTH - 1 ||
      settledPixels > maxWidth + 1 ||
      groupWidth - RESIZE_SEPARATOR_WIDTH - settledPixels < contentMinWidth - 1
    )
    if (invalidExpandedLayout) {
      userResizeIntentRef.current = false
      userResizeChangedRef.current = false
      scheduleExpandedLayoutRepair()
      return
    }

    if (!userResizeIntentRef.current) return
    // Keyboard layout callbacks run before the browser has painted the new
    // flex width, so offsetWidth can lag one key press behind. The settled
    // layout map is already authoritative; convert its percentage using the
    // measured group budget and keep the imperative size as a cancellation
    // fallback only.
    const nextWidth = clampWidth(settledPixels, MIN_WIDTH)
    commitPreferredWidth(nextWidth)
    userResizeIntentRef.current = false
    userResizeChangedRef.current = false
  }, [commitPreferredWidth, contentMinWidth, maxWidth, navigatorPanelId, scheduleExpandedLayoutRepair])

  const beginUserResize = useCallback(() => {
    userResizeIntentRef.current = true
    userResizeChangedRef.current = false
  }, [])

  const beginPointerResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    const handle = resizeHandleRef.current
    if (!handle) return
    const rect = handle.getBoundingClientRect()
    const targetSize = event.pointerType === 'mouse' ? 10 : 28
    const hitSlop = Math.max(0, (targetSize - rect.width) / 2)
    if (event.clientX < rect.left - hitSlop || event.clientX > rect.right + hitSlop) return
    beginUserResize()
    // The primitive tracks pointer movement at the document level. Capture the
    // same pointer on the product-owned group so a fast throw outside the
    // navigator still delivers pointerup/cancel and cannot strand our gesture
    // refs or block geometry recovery indefinitely.
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // The pointer may already have ended between native capture phases.
      }
    }
    pointerGestureRef.current = event.pointerId
  }, [beginUserResize])

  const finishUserResize = useCallback(() => {
    if (!userResizeIntentRef.current) return
    const panel = sidebarPanelRef.current
    if (userResizeChangedRef.current && panel) {
      const width = panel.getSize().inPixels
      if (width >= MIN_WIDTH - 1 && width <= maxWidth + 1) {
        commitPreferredWidth(clampWidth(width, MIN_WIDTH))
      }
    }
    userResizeIntentRef.current = false
    userResizeChangedRef.current = false
  }, [commitPreferredWidth, maxWidth])

  const finishPointerResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pointerGestureRef.current = null
    finishUserResize()
    scheduleExpandedLayoutRepair()
  }, [finishUserResize, scheduleExpandedLayoutRepair])

  useLayoutEffect(() => {
    if (!isDesktop || containerWidth <= 0 || userResizeIntentRef.current) return
    const panel = sidebarPanelRef.current
    if (!panel) return
    const targetWidth = Math.min(latestWidthRef.current, maxWidth)
    const currentWidth = panel.getSize().inPixels
    if (Math.abs(currentWidth - targetWidth) > 1) {
      panel.resize(targetWidth)
    }
  }, [containerWidth, contentMinWidth, isDesktop, layoutEpoch, maxWidth])

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false)
  }, [isDesktop])

  useEffect(() => {
    if (!isDesktop || typeof ResizeObserver === 'undefined') return
    const navigator = navigatorElementRef.current
    const content = contentElementRef.current
    if (!navigator || !content) return

    // The primitive's onResize callback is store-driven. Observe the actual
    // flex items as an independent invariant boundary so a stale DOM write can
    // never remain full-screen merely because the store reports a valid size.
    const observer = new ResizeObserver(scheduleExpandedLayoutRepair)
    observer.observe(navigator)
    observer.observe(content)
    return () => observer.disconnect()
  }, [isDesktop, layoutEpoch, scheduleExpandedLayoutRepair])

  useEffect(() => () => {
    if (layoutRepairFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutRepairFrameRef.current)
      layoutRepairFrameRef.current = null
    }
  }, [])

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
  }, [isDesktop, layoutEpoch])

  const drawerButton = (
    <Tooltip>
      <TooltipTrigger render={(
        <Button type="button" onClick={openMobileDrawer}
          ref={mobileTriggerRef}
          variant="ghost" size="icon-sm" className="text-muted-foreground"
          aria-label={t('common.openPanel', { title })}
          aria-expanded={drawerOpen}
          aria-controls={mobileDrawerId}
          aria-haspopup="dialog"
        />
      )}>
        <List size={16} strokeWidth={1.75} aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{t('common.openPanel', { title })}</TooltipContent>
    </Tooltip>
  )

  const sidebarPanel = (
    <Sidebar title={title} leading={primaryNavigation} actions={actionContent}>
      {sidebarContent}
    </Sidebar>
  )

  if (isDesktop) {
    return (
      <ResizablePanelGroup
        key={layoutEpoch}
        id={`page-sidebar-${storageKey}`}
        elementRef={rootRef}
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
        onPointerDownCapture={beginPointerResize}
        onPointerUpCapture={finishPointerResize}
        onPointerCancelCapture={finishPointerResize}
        resizeTargetMinimumSize={{ fine: 10, coarse: 28 }}
        className="oa-page-sidebar-resizable min-h-0 min-w-0 overflow-hidden"
      >
        <ResizablePanel
          id={navigatorPanelId}
          data-page-sidebar-panel="navigator"
          elementRef={navigatorElementRef}
          panelRef={sidebarPanelRef}
          defaultSize={groupDefaultSizeRef.current}
          minSize={MIN_WIDTH}
          maxSize={maxWidth}
          collapsible={false}
          groupResizeBehavior="preserve-pixel-size"
          onResize={handleSidebarResize}
          className="h-full min-h-0 overflow-hidden bg-sidebar"
        >
          <div data-testid="page-sidebar-desktop" className="h-full min-h-0 w-full overflow-hidden bg-sidebar">
            <div data-testid="page-sidebar-expanded" className="h-full min-h-0">
              {sidebarPanel}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle
          id={`page-sidebar-${storageKey}-handle`}
          elementRef={resizeHandleRef}
          aria-label={t('common.resizePanel', { title })}
          onKeyDownCapture={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              beginUserResize()
            }
          }}
          onKeyUp={finishUserResize}
          onBlur={finishUserResize}
          className="z-10 bg-sidebar-border/70 transition-colors hover:bg-foreground/18 active:bg-foreground/28"
        />
        <ResizablePanel
          id={`page-sidebar-${storageKey}-content`}
          data-page-sidebar-panel="content"
          elementRef={contentElementRef}
          minSize={contentMinWidth}
          groupResizeBehavior="preserve-relative-size"
          className="min-h-0 min-w-0"
        >
          <PrimaryNavigationContext.Provider value={null}>
            <PageContentLayout title={title}>
              {children}
            </PageContentLayout>
          </PrimaryNavigationContext.Provider>
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
        <PageContentLayout title={title} leading={!usesAppContextBar ? drawerButton : undefined}>
          {children}
        </PageContentLayout>
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
          className="oa-page-sidebar-dialog h-dvh max-h-none w-[280px] max-w-[85vw] gap-0 overflow-hidden border-r border-sidebar-border/70 bg-sidebar p-0 text-sidebar-foreground"
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
              <Button
                type="button"
                onClick={() => setDrawerOpen(false)}
                variant="ghost"
                size="icon-lg"
                className="-ml-1 h-10 w-10 text-muted-foreground"
                aria-label={t('common.closePanel', { title })}
              >
                <X size={15} strokeWidth={1.75} aria-hidden />
              </Button>
            }
          >
            {sidebarContent}
          </Sidebar>
        </SheetContent>
      </Sheet>
    </div>
  )
}
