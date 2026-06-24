import { useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { TabHost } from './components/TabHost'
import { UpdateBanner } from './components/UpdateBanner'
import { DemoBanner } from './demo/DemoBanner'
import { DemoAnalytics } from './demo/DemoAnalytics'
import { WorkspacesProvider } from './contexts/WorkspacesContext'
import { findSectionForActivity } from './sections'
import { UrlAdopter } from './tabs/UrlAdopter'
import { useWorkspace } from './tabs/store'
import { useSidebarWidth, resolveSidebarWidth } from './live/sidebar-width'
import { getFocusedTab } from './tabs/types'
import { useLocale } from './i18n/useLocale'
import { useTranslation } from 'react-i18next'

/**
 * Activity-bar pages — only items that appear as icons in the ActivityBar.
 * Each maps to one or more tab kinds via tabs/registry.ts (defaultSpecForActivity).
 */
export type Page =
  | 'chat' | 'inbox' | 'tracked' | 'workspaces' | 'portfolio' | 'news' | 'automation' | 'market'
  | 'trading-as-git'
  | 'settings' | 'dev'

/** Subscribe to a CSS media query, SSR-safe (defaults to matched). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    setMatches(mq.matches) // re-sync in case the query changed between renders
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}

/**
 * Two breakpoints drive a three-tier responsive shell:
 *  - <768  (phone):  rail = drawer (hamburger), sidebar = drawer (drill-in)
 *  - 768–1024 (tablet/narrow): rail = static column, sidebar = drawer
 *    (tap a rail icon to slide it in) — keeps the main pane full-width-
 *    minus-rail so its `md:` content layouts have real room
 *  - ≥1024 (desktop): rail + sidebar both static (classic 3-pane)
 * The middle tier is what kills the old 768–~1000px dead zone where two
 * static left columns (216+200) crushed the main pane and its md:-keyed
 * content (stat grids, tables) overflowed/overlapped.
 */
const useIsDesktop = () => useMediaQuery('(min-width: 768px)') // rail static
const useIsWide = () => useMediaQuery('(min-width: 1024px)') // sidebar static

export function App() {
  return (
    <WorkspacesProvider>
      <AppShell />
    </WorkspacesProvider>
  )
}

function AppShell() {
  // Re-render the shell on a language switch so formatter-only subtrees
  // (charts, money/date labels that don't call t()) refresh too.
  useLocale()
  const { t } = useTranslation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [secondaryOpen, setSecondaryOpen] = useState(false)
  const selectedSidebar = useWorkspace((state) => state.selectedSidebar)
  const focusedTabId = useWorkspace((state) => getFocusedTab(state)?.id ?? null)
  const section = findSectionForActivity(selectedSidebar)
  const isDesktop = useIsDesktop() // ≥768 — rail is a static column
  const isWide = useIsWide() // ≥1024 — sidebar is a static panel
  const showSidebarPanel = isWide && section != null

  // Auto-close the mobile secondary drawer once the user picks a sub-item.
  // We snapshot the focused tab at drawer-open time (see openSecondaryDrawer
  // below) and watch for it to change while the drawer is open. Baseline
  // approach matters: an activity click that has a `defaultTab` also changes
  // the focused tab in the same commit; without the snapshot we'd close the
  // drawer the moment it opens.
  const secondaryBaselineTab = useRef<string | null>(focusedTabId)
  useEffect(() => {
    if (!secondaryOpen) {
      secondaryBaselineTab.current = focusedTabId
      return
    }
    if (secondaryBaselineTab.current !== focusedTabId) {
      setSecondaryOpen(false)
    }
  }, [focusedTabId, secondaryOpen])

  // When a tier's static column takes over, drop its drawer state. The rail
  // goes static at ≥768 (drop the activity drawer); the sidebar goes static
  // at ≥1024 (drop the secondary drawer). Kept as two effects so the middle
  // tier — rail static, sidebar still a drawer — settles correctly.
  useEffect(() => {
    if (isDesktop) setSidebarOpen(false)
  }, [isDesktop])
  useEffect(() => {
    if (isWide) setSecondaryOpen(false)
  }, [isWide])

  // Lock body scroll while a drawer is open so the page behind doesn't drift
  // under the backdrop. Restores the previous value on close/unmount.
  useEffect(() => {
    if (!sidebarOpen && !secondaryOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [sidebarOpen, secondaryOpen])

  // Per-activity secondary-sidebar width. The width is owned per
  // ActivitySection (see live/sidebar-width.ts) rather than as one global
  // layout: switching activities re-applies that activity's width
  // imperatively via the panel's `resize()` — NO Group remount, so the
  // main panel's tabs (TabHost) keep their state. `defaultSize` (px) seeds
  // the very first mount; the effect handles subsequent switches.
  const sidebarRef = usePanelRef()
  const sidebarWidths = useSidebarWidth((s) => s.widths)
  const setSidebarWidth = useSidebarWidth((s) => s.setWidth)
  const sidebarWidth = resolveSidebarWidth(selectedSidebar, sidebarWidths)
  // Guards onResize from persisting our OWN programmatic resizes — only a
  // user drag should pin a width over the tuned default.
  const programmaticResize = useRef(false)

  useEffect(() => {
    if (!showSidebarPanel || !selectedSidebar) return
    const target = `${resolveSidebarWidth(selectedSidebar, sidebarWidths)}px`
    programmaticResize.current = true
    // Defer one frame and guard with try/catch: calling resize() on a
    // freshly-mounted panel throws "Layout not found for Panel sidebar"
    // because the group's layout isn't registered until after the first
    // layout pass. The Panel's px `defaultSize` already gives the correct
    // width on first mount, so this imperative resize only needs to succeed
    // on activity switches (where the panel stays mounted and layout exists).
    const apply = requestAnimationFrame(() => {
      try {
        sidebarRef.current?.resize(target)
      } catch {
        /* layout not ready yet — defaultSize covers the initial mount */
      }
    })
    const clear = requestAnimationFrame(() => { programmaticResize.current = false })
    return () => { cancelAnimationFrame(apply); cancelAnimationFrame(clear) }
    // Re-apply when the activity changes (sidebarWidths intentionally not a
    // dep — a persist write shouldn't trigger a re-resize loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSidebar, showSidebarPanel])

  const mainContent = (
    <main className="flex flex-col min-w-0 min-h-0 bg-bg h-full">
      {/* Mobile header — visible only below md */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/80 bg-bg-secondary shrink-0 md:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-text-muted hover:text-text p-1 -ml-1"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-text">OpenAlice</span>
      </div>

      <TabHost />
    </main>
  )

  return (
    <div className="flex flex-col h-full">
      {import.meta.env.VITE_DEMO_MODE && <DemoBanner />}
      {import.meta.env.VITE_DEMO_MODE && <DemoAnalytics />}
      <UpdateBanner />
      <div className="flex flex-1 min-h-0">
        <ActivityBar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          sidebarVisible={showSidebarPanel || secondaryOpen}
          onItemActivated={(landedOn) => {
            // Drill-down for any viewport without a static sidebar (<1024):
            // close the activity drawer and slide in the secondary navigator
            // for the landed-on section. If the user toggled the current
            // section off (landedOn === null), just close.
            setSidebarOpen(false)
            if (!isWide && landedOn != null) {
              // Snapshot post-click state — `defaultTab` may have just changed
              // the focused tab synchronously via Zustand, and we want THAT to
              // be the baseline (not the pre-click value the closure captured).
              secondaryBaselineTab.current =
                getFocusedTab(useWorkspace.getState())?.id ?? null
              setSecondaryOpen(true)
            }
          }}
        />

        <Group
          orientation="horizontal"
          // Layout-cache version. Bump this whenever the panel structure /
          // sizing model changes so clients don't apply a stale persisted
          // layout. v2: moved from a single global percent split
          // (useDefaultLayout) to per-activity px widths (live/sidebar-width).
          id="main-layout-v2"
          className="flex-1 min-h-0"
        >
          {showSidebarPanel && section && (
            <>
              <Panel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={`${sidebarWidth}px`}
                minSize="200px"
                maxSize="420px"
                groupResizeBehavior="preserve-pixel-size"
                onResize={(size, _id, prev) => {
                  // prev === undefined on mount; skip our own programmatic
                  // resizes — persist only genuine user drags, per activity.
                  if (prev === undefined || programmaticResize.current) return
                  if (selectedSidebar) setSidebarWidth(selectedSidebar, size.inPixels)
                }}
              >
                <Sidebar
                  title={t(section.titleKey)}
                  actions={section.Actions ? <section.Actions /> : undefined}
                >
                  <section.Secondary />
                </Sidebar>
              </Panel>
              <Separator className="w-px bg-border/80 hover:bg-accent/40 active:bg-accent/60 transition-colors" />
            </>
          )}
          <Panel id="main">
            {mainContent}
          </Panel>
        </Group>

        {/* Secondary sidebar drawer for any non-wide viewport (<1024) —
            drills in after the user picks an activity (from the rail drawer
            on phones, or the static rail at 768–1024). At ≥1024 the sidebar
            renders as a static Panel above; this branch is gated on !isWide
            so the two never co-exist. */}
        {!isWide && section && (
          <MobileSecondaryDrawer
            open={secondaryOpen}
            section={section}
            onClose={() => setSecondaryOpen(false)}
            onBack={() => {
              setSecondaryOpen(false)
              // Only re-open the rail drawer when the rail is itself a drawer
              // (<768). At 768–1024 the rail is static, so just close.
              if (!isDesktop) setSidebarOpen(true)
            }}
          />
        )}

        <UrlAdopter />
      </div>
    </div>
  )
}

interface MobileSecondaryDrawerProps {
  open: boolean
  section: NonNullable<ReturnType<typeof findSectionForActivity>>
  onClose: () => void
  onBack: () => void
}

function MobileSecondaryDrawer({ open, section, onClose, onBack }: MobileSecondaryDrawerProps) {
  const { t } = useTranslation()
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div
        className={`
          fixed top-0 left-0 z-50 h-full w-[280px] max-w-[85vw]
          lg:hidden
          transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <Sidebar
          title={t(section.titleKey)}
          actions={section.Actions ? <section.Actions /> : undefined}
          leading={
            <button
              type="button"
              onClick={onBack}
              className="text-text-muted hover:text-text p-1 -ml-1"
              aria-label="Back to menu"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4l-6 6 6 6" />
              </svg>
            </button>
          }
        >
          <section.Secondary />
        </Sidebar>
      </div>
    </>
  )
}

