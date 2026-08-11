import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Layout, PanelImperativeHandle, PanelSize } from 'react-resizable-panels'
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
const RESIZE_SEPARATOR_WIDTH = 1
const COLLAPSE_MOTION_CLEANUP_MS = 260
const OVERDRAG_ARM_DISTANCE = 64
const OVERDRAG_COLLAPSE_DISTANCE = (MIN_WIDTH - COLLAPSED_WIDTH) / 2
const OVERDRAG_DAMPING_DISTANCE = 38
const OVERDRAG_MAX_VISUAL_DISTANCE = 34
const OVERDRAG_RETURN_CLEANUP_MS = 280

export function calculatePageSidebarOverdrag(rawDistance: number): number {
  if (!Number.isFinite(rawDistance) || rawDistance <= 0) return 0
  return OVERDRAG_MAX_VISUAL_DISTANCE * (
    1 - Math.exp(-rawDistance / OVERDRAG_DAMPING_DISTANCE)
  )
}

export function shouldCollapsePageSidebar(rawDistance: number): boolean {
  return Number.isFinite(rawDistance) && rawDistance >= OVERDRAG_COLLAPSE_DISTANCE
}

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
  const isDesktop = useIsDesktop(desktopMinWidth)
  const isAppDesktop = useIsDesktop(768)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const navigatorElementRef = useRef<HTMLDivElement | null>(null)
  const contentElementRef = useRef<HTMLDivElement | null>(null)
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null)
  const resizeHandleRef = useRef<HTMLDivElement | null>(null)
  const userResizeIntentRef = useRef(false)
  const userResizeChangedRef = useRef(false)
  const programmaticCollapseRef = useRef(false)
  const collapseMotionTimerRef = useRef<number | null>(null)
  const overdragMotionTimerRef = useRef<number | null>(null)
  const layoutRepairFrameRef = useRef<number | null>(null)
  const layoutRecoveryInFlightRef = useRef(false)
  const pointerGestureRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    rawOverdrag: number
  } | null>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mobileDrawerRef = useRef<HTMLDivElement | null>(null)
  const mobileDrawerId = useId()
  const navigatorPanelId = `page-sidebar-${storageKey}-navigator`
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => readStoredCollapsed(storageKey))
  const collapsedRef = useRef(collapsed)
  const [preferredWidth, setPreferredWidth] = useState(() =>
    readStoredWidth(storageKey, clampWidth(defaultWidth, defaultWidth)),
  )
  const latestWidthRef = useRef(preferredWidth)
  // `react-resizable-panels` unregisters and re-registers a Panel whenever its
  // defaultSize prop changes. A pointer may cross the collapse midpoint more
  // than once before release, so deriving this prop from `collapsed` tears the
  // active group apart mid-gesture and can leave a stale 100% / 0% flex pair.
  // Keep the registration default stable for the lifetime of a group instance;
  // an explicit recovery changes the key and supplies a new stable default.
  const groupDefaultSizeRef = useRef(
    collapsed ? COLLAPSED_WIDTH : preferredWidth,
  )
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

  const updateCollapsed = useCallback((next: boolean) => {
    if (collapsedRef.current === next) return
    collapsedRef.current = next
    setCollapsed(next)
    window.localStorage.setItem(collapsedStorageName(storageKey), next ? '1' : '0')
  }, [storageKey])

  const hasInvalidExpandedLayout = useCallback(() => {
    const root = rootRef.current
    const navigator = navigatorElementRef.current
    const content = contentElementRef.current
    const groupWidth = root?.getBoundingClientRect().width ?? 0
    if (
      !root ||
      !navigator ||
      !content ||
      collapsedRef.current ||
      groupWidth <= RESIZE_SEPARATOR_WIDTH ||
      pointerGestureRef.current ||
      layoutRecoveryInFlightRef.current
    ) return false

    // Read painted geometry rather than the imperative Panel size. During a
    // registration race the library's layout store and ARIA metadata can be
    // valid while the flex styles left on the DOM are still 100% / 0%.
    const currentWidth = navigator.getBoundingClientRect().width
    const currentContentWidth = content.getBoundingClientRect().width
    const collapseIsAnimating = root.hasAttribute('data-collapse-motion')
    return currentWidth > maxWidth + 1 ||
      currentContentWidth < contentMinWidth - 1 ||
      (!collapseIsAnimating && currentWidth < MIN_WIDTH - 1)
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
    // react-resizable-panels publishes its percentage layout synchronously,
    // before the browser paints the matching flex width. During an imperative
    // collapse, `inPixels` can therefore still be the old expanded DOM width
    // even though `asPercentage` already represents the 44px rail. Derive the
    // applied logical width from the settled percentage so the product state
    // cannot immediately bounce back to "expanded".
    const logicalPixels = groupWidth > RESIZE_SEPARATOR_WIDTH && Number.isFinite(size.asPercentage)
      ? ((groupWidth - RESIZE_SEPARATOR_WIDTH) * size.asPercentage) / 100
      : size.inPixels
    const nextCollapsed = logicalPixels <= COLLAPSED_WIDTH + 1
    if (programmaticCollapseRef.current) {
      // resize(0) may report several interpolated widths while it crosses the
      // min-size gap. Keep the explicit collapse intent authoritative until
      // the primitive reaches its configured collapsed size.
      if (!nextCollapsed) return
      programmaticCollapseRef.current = false
    }
    // Applied panel geometry is the source of truth for which surface is
    // interactive. Pointer drags may begin inside react-resizable-panels'
    // enlarged virtual hit region rather than on the one-pixel Separator DOM
    // node, so interaction bookkeeping must never gate this synchronization.
    updateCollapsed(nextCollapsed)
    // Constraint re-registration may write a stale one-panel layout after the
    // group's own settled-layout callback has already fired. The Panel
    // ResizeObserver is the last reliable boundary for that delayed write.
    if (!nextCollapsed) {
      const invalidLayout = groupWidth > RESIZE_SEPARATOR_WIDTH && (
        logicalPixels < MIN_WIDTH - 1 ||
        logicalPixels > maxWidth + 1 ||
        groupWidth - RESIZE_SEPARATOR_WIDTH - logicalPixels < contentMinWidth - 1
      )
      if (invalidLayout) scheduleExpandedLayoutRepair()
    }
    if (userResizeIntentRef.current) {
      userResizeChangedRef.current = true
    }
  }, [contentMinWidth, maxWidth, scheduleExpandedLayoutRepair, updateCollapsed])

  const handleLayoutChanged = useCallback((layout: Layout) => {
    const panel = sidebarPanelRef.current
    if (!panel) return

    const groupWidth = rootRef.current?.getBoundingClientRect().width ?? 0
    const percentage = layout[navigatorPanelId]
    const settledPixels = groupWidth > RESIZE_SEPARATOR_WIDTH && Number.isFinite(percentage)
      ? ((groupWidth - RESIZE_SEPARATOR_WIDTH) * percentage) / 100
      : panel.getSize().inPixels
    const appliedCollapsed = panel.isCollapsed()

    // react-resizable-panels re-registers a Panel when a pixel constraint
    // changes. During that registration window it can briefly settle a
    // one-panel layout at 100%, even though the rebuilt separator still
    // advertises the correct max. Never persist that impossible geometry.
    // Restore the product preference after registration has settled instead.
    const invalidExpandedLayout = !appliedCollapsed && (
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
    if (appliedCollapsed) {
      userResizeIntentRef.current = false
      userResizeChangedRef.current = false
      return
    }
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

  const disarmCollapseMotion = useCallback(() => {
    if (collapseMotionTimerRef.current !== null) {
      window.clearTimeout(collapseMotionTimerRef.current)
      collapseMotionTimerRef.current = null
    }
    rootRef.current?.removeAttribute('data-collapse-motion')
  }, [])

  const cancelOverdragCleanup = useCallback(() => {
    if (overdragMotionTimerRef.current !== null) {
      window.clearTimeout(overdragMotionTimerRef.current)
      overdragMotionTimerRef.current = null
    }
  }, [])

  const clearOverdragMotion = useCallback(() => {
    cancelOverdragCleanup()
    const root = rootRef.current
    if (!root) return
    root.removeAttribute('data-overdrag-motion')
    root.removeAttribute('data-overdrag-state')
    root.style.removeProperty('--oa-page-sidebar-overdrag')
  }, [cancelOverdragCleanup])

  const interruptOverdragMotion = useCallback(() => {
    cancelOverdragCleanup()
    const root = rootRef.current
    const navigator = root?.querySelector<HTMLElement>('[data-page-sidebar-panel="navigator"]')
    const handle = resizeHandleRef.current
    if (!root || !navigator || !handle) return
    // Freeze the currently painted spring position before removing its
    // transition. Snapping the handle back under an active pointer can cancel
    // pointer capture, which made an immediately repeated drag lose resistance.
    const visualOffset = Math.max(
      0,
      navigator.getBoundingClientRect().right - handle.getBoundingClientRect().left,
    )
    root.style.setProperty('--oa-page-sidebar-overdrag', `${visualOffset.toFixed(3)}px`)
    root.removeAttribute('data-overdrag-motion')
    root.removeAttribute('data-overdrag-state')
  }, [cancelOverdragCleanup])

  const scheduleOverdragCleanup = useCallback(() => {
    if (overdragMotionTimerRef.current !== null) {
      window.clearTimeout(overdragMotionTimerRef.current)
    }
    overdragMotionTimerRef.current = window.setTimeout(() => {
      overdragMotionTimerRef.current = null
      const root = rootRef.current
      if (!root) return
      root.removeAttribute('data-overdrag-motion')
      root.removeAttribute('data-overdrag-state')
      root.style.removeProperty('--oa-page-sidebar-overdrag')
    }, OVERDRAG_RETURN_CLEANUP_MS)
  }, [])

  const armCollapseMotion = useCallback((scheduleCleanup = true) => {
    const root = rootRef.current
    if (!root) return
    root.setAttribute('data-collapse-motion', 'armed')
    if (collapseMotionTimerRef.current !== null) {
      window.clearTimeout(collapseMotionTimerRef.current)
    }
    if (scheduleCleanup) {
      collapseMotionTimerRef.current = window.setTimeout(() => {
        collapseMotionTimerRef.current = null
        root.removeAttribute('data-collapse-motion')
      }, COLLAPSE_MOTION_CLEANUP_MS)
    }
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
    // A return/commit cleanup from the previous gesture must not be allowed to
    // erase the next gesture. This is also required when the next gesture
    // starts from the collapsed rail and re-opens the panel.
    interruptOverdragMotion()
    const panel = sidebarPanelRef.current
    if (!panel || panel.isCollapsed()) return
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panel.getSize().inPixels,
      rawOverdrag: 0,
    }
  }, [beginUserResize, interruptOverdragMotion])

  const updatePointerOverdrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current
    const root = rootRef.current
    if (!gesture || !root || event.pointerId !== gesture.pointerId || event.buttons !== 1) return

    const rawWidth = gesture.startWidth + event.clientX - gesture.startX
    const rawOverdrag = Math.max(0, MIN_WIDTH - rawWidth)
    gesture.rawOverdrag = rawOverdrag

    if (rawOverdrag === 0) {
      disarmCollapseMotion()
      root.removeAttribute('data-overdrag-state')
      root.style.setProperty('--oa-page-sidebar-overdrag', '0px')
      return
    }

    if (shouldCollapsePageSidebar(rawOverdrag)) {
      root.setAttribute('data-overdrag-state', 'armed')
      root.style.setProperty('--oa-page-sidebar-overdrag', '0px')
      // Keep the transition armed for the held gesture, but do not let a timer
      // remove it underneath a slow drag. Pointer release owns cleanup.
      armCollapseMotion(false)
      return
    }

    // Reversing back across the collapse boundary must make flex geometry
    // cursor-attached again. Leaving the transition active makes painted width
    // lag the primitive's layout and is the main trigger for rapid-drag drift.
    disarmCollapseMotion()
    if (root.hasAttribute('data-overdrag-motion')) clearOverdragMotion()
    const visualDistance = calculatePageSidebarOverdrag(rawOverdrag)
    root.style.setProperty('--oa-page-sidebar-overdrag', `${visualDistance.toFixed(3)}px`)
    root.setAttribute(
      'data-overdrag-state',
      rawOverdrag >= OVERDRAG_ARM_DISTANCE ? 'armed' : 'resisting',
    )
  }, [armCollapseMotion, clearOverdragMotion, disarmCollapseMotion])

  const returnFromOverdrag = useCallback(() => {
    const root = rootRef.current
    if (!root || !root.hasAttribute('data-overdrag-state')) {
      clearOverdragMotion()
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clearOverdragMotion()
      return
    }
    root.setAttribute('data-overdrag-motion', 'returning')
    root.removeAttribute('data-overdrag-state')
    window.requestAnimationFrame(() => {
      root.style.setProperty('--oa-page-sidebar-overdrag', '0px')
    })
    scheduleOverdragCleanup()
  }, [clearOverdragMotion, scheduleOverdragCleanup])

  const finishUserResize = useCallback(() => {
    if (!sidebarPanelRef.current?.isCollapsed()) disarmCollapseMotion()
    if (!userResizeIntentRef.current) return
    const panel = sidebarPanelRef.current
    if (userResizeChangedRef.current && panel && !panel.isCollapsed()) {
      commitPreferredWidth(clampWidth(panel.getSize().inPixels, MIN_WIDTH))
    }
    userResizeIntentRef.current = false
    userResizeChangedRef.current = false
  }, [commitPreferredWidth, disarmCollapseMotion])

  const finishPointerResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const gesture = pointerGestureRef.current
    pointerGestureRef.current = null

    if (gesture && shouldCollapsePageSidebar(gesture.rawOverdrag)) {
      const root = rootRef.current
      root?.setAttribute('data-overdrag-motion', 'committing')
      root?.removeAttribute('data-overdrag-state')
      root?.style.setProperty('--oa-page-sidebar-overdrag', '0px')
      armCollapseMotion()
      scheduleOverdragCleanup()
      // The shadcn primitive owns the threshold geometry. Calling collapse()
      // again here races its pointer-up settlement and can overwrite the
      // primitive's remembered expanded layout.
      finishUserResize()
      scheduleExpandedLayoutRepair()
      return
    }

    disarmCollapseMotion()
    returnFromOverdrag()
    finishUserResize()
    scheduleExpandedLayoutRepair()
  }, [
    armCollapseMotion,
    disarmCollapseMotion,
    finishUserResize,
    returnFromOverdrag,
    scheduleExpandedLayoutRepair,
    scheduleOverdragCleanup,
  ])

  const cancelPointerResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pointerGestureRef.current = null
    disarmCollapseMotion()
    returnFromOverdrag()
    finishUserResize()
    scheduleExpandedLayoutRepair()
  }, [disarmCollapseMotion, finishUserResize, returnFromOverdrag, scheduleExpandedLayoutRepair])

  const collapseSidebar = useCallback(() => {
    clearOverdragMotion()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduceMotion) armCollapseMotion()

    // Asking for zero crosses the primitive's collapse midpoint and lets it
    // snap to the configured 44px collapsedSize. Its collapse() command can
    // stop at minSize when pixel constraints are rounded during a recovered
    // group lifecycle, which is what left the header button looking dead.
    programmaticCollapseRef.current = true
    updateCollapsed(true)
    sidebarPanelRef.current?.resize(0)
  }, [armCollapseMotion, clearOverdragMotion, updateCollapsed])

  const expandSidebar = useCallback(() => {
    programmaticCollapseRef.current = false
    const targetWidth = Math.min(latestWidthRef.current, maxWidth)
    disarmCollapseMotion()
    clearOverdragMotion()
    // resize() expands a collapsed primitive and restores the exact persisted
    // pixel preference in one transaction. expand()+resize() creates two
    // competing layouts and can poison the next collapse cycle.
    sidebarPanelRef.current?.resize(targetWidth)
    updateCollapsed(false)
  }, [clearOverdragMotion, disarmCollapseMotion, maxWidth, updateCollapsed])

  useLayoutEffect(() => {
    if (!isDesktop || containerWidth <= 0 || userResizeIntentRef.current) return
    const panel = sidebarPanelRef.current
    if (!panel) return
    if (collapsed) {
      if (!panel.isCollapsed()) panel.resize(0)
      return
    }
    const targetWidth = Math.min(latestWidthRef.current, maxWidth)
    const currentWidth = panel.getSize().inPixels
    if (panel.isCollapsed() || Math.abs(currentWidth - targetWidth) > 1) {
      panel.resize(targetWidth)
    }
  }, [collapsed, containerWidth, contentMinWidth, isDesktop, layoutEpoch, maxWidth])

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
    programmaticCollapseRef.current = false
    if (layoutRepairFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutRepairFrameRef.current)
      layoutRepairFrameRef.current = null
    }
    disarmCollapseMotion()
    clearOverdragMotion()
  }, [clearOverdragMotion, disarmCollapseMotion])

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
        key={layoutEpoch}
        id={`page-sidebar-${storageKey}`}
        elementRef={rootRef}
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
        onPointerDownCapture={beginPointerResize}
        onPointerMoveCapture={updatePointerOverdrag}
        onPointerUpCapture={finishPointerResize}
        onPointerCancelCapture={cancelPointerResize}
        resizeTargetMinimumSize={{ fine: 10, coarse: 28 }}
        className="oa-page-sidebar-resizable min-h-0 min-w-0 overflow-hidden"
      >
        <ResizablePanel
          id={navigatorPanelId}
          data-page-sidebar-panel="navigator"
          data-collapse-state={collapsed ? 'collapsed' : 'expanded'}
          elementRef={navigatorElementRef}
          panelRef={sidebarPanelRef}
          defaultSize={groupDefaultSizeRef.current}
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
            </aside>
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
            if (event.key === 'ArrowLeft' || event.key === 'Home') {
              armCollapseMotion()
            }
          }}
          onKeyUp={finishUserResize}
          onBlur={finishUserResize}
          className="z-10 bg-border/80 transition-colors hover:bg-primary/50 active:bg-primary/70"
        />
        <ResizablePanel
          id={`page-sidebar-${storageKey}-content`}
          data-page-sidebar-panel="content"
          elementRef={contentElementRef}
          minSize={contentMinWidth}
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
