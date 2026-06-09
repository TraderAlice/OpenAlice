import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
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

/** Track whether we're at a desktop viewport (md+ in Tailwind = ≥768px). */
function useIsDesktop(): boolean {
  const query = '(min-width: 768px)'
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return matches
}

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
  const isDesktop = useIsDesktop()
  const showSidebarPanel = isDesktop && section != null
  const showDemoBanner = import.meta.env.VITE_DEMO_MODE && import.meta.env.VITE_SHOW_DEMO_BANNER

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

  // If we cross into desktop while a mobile drawer is open, drop the drawer
  // state — the static columns now own the rendering.
  useEffect(() => {
    if (isDesktop) {
      setSidebarOpen(false)
      setSecondaryOpen(false)
    }
  }, [isDesktop])

  // Persist the user's resized layout to localStorage. `panelIds` scopes the
  // saved layout to the current panel set — sidebar+main and main-only get
  // independent entries, so the sidebar width survives mobile/desktop toggles
  // and route changes that drop the sidebar.
  const panelIds = useMemo(
    () => (showSidebarPanel ? ['sidebar', 'main'] : ['main']),
    [showSidebarPanel],
  )
  const { defaultLayout: savedLayout, onLayoutChanged } = useDefaultLayout({
    id: 'main-layout',
    panelIds,
  })
  const fallbackLayout: Record<string, number> = showSidebarPanel
    ? { sidebar: 20, main: 80 }
    : { main: 100 }

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
      {showDemoBanner && <DemoBanner />}
      {import.meta.env.VITE_DEMO_MODE && <DemoAnalytics />}
      <UpdateBanner />
      <div className="flex flex-1 min-h-0">
        <ActivityBar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onItemActivated={(landedOn) => {
            // Mobile drill-down: close the activity drawer and slide in the
            // secondary navigator for the landed-on section. If the user
            // toggled the current section off (landedOn === null), just close.
            setSidebarOpen(false)
            if (!isDesktop && landedOn != null) {
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
          id="main-layout"
          className="flex-1 min-h-0"
          defaultLayout={savedLayout ?? fallbackLayout}
          onLayoutChanged={onLayoutChanged}
        >
          {showSidebarPanel && section && (
            <>
              <Panel id="sidebar" defaultSize={20} minSize="200px" maxSize="500px">
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

        {/* Mobile-only secondary sidebar drawer — drills in after the user
            picks an activity in the ActivityBar drawer. Desktop renders the
            sidebar as a static Panel above; this branch is gated on !isDesktop
            so the two never co-exist. */}
        {!isDesktop && section && (
          <MobileSecondaryDrawer
            open={secondaryOpen}
            section={section}
            onClose={() => setSecondaryOpen(false)}
            onBack={() => {
              setSecondaryOpen(false)
              setSidebarOpen(true)
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
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div
        className={`
          fixed top-0 left-0 z-50 h-full w-[280px] max-w-[85vw]
          md:hidden
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

