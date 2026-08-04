import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ActivityBar } from './components/ActivityBar'
import { MobileContextBar } from './components/MobileContextBar'
import { TabHost } from './components/TabHost'
import { DesktopUpdatePrompt } from './components/DesktopUpdatePrompt'
import { UpdateBanner } from './components/UpdateBanner'
import { DemoBanner } from './demo/DemoBanner'
import { DemoAnalytics } from './demo/DemoAnalytics'
import { WorkspacesProvider } from './contexts/WorkspacesContext'
import {
  MobilePageNavigationProvider,
  useMobilePageNavigation,
} from './contexts/MobilePageNavigationContext'
import { UrlAdopter } from './tabs/UrlAdopter'
import { useLocale } from './i18n/useLocale'

/**
 * Activity-bar pages — only items that appear as icons in the ActivityBar.
 * Each maps to one or more tab kinds via tabs/registry.ts (defaultSpecForActivity).
 */
export type Page =
  | 'chat' | 'auto-quant' | 'inbox' | 'tracked' | 'workspaces' | 'portfolio' | 'news' | 'automation' | 'market'
  | 'issue'
  | 'trading-as-git'
  | 'connectors'
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
 * Three breakpoints drive the responsive shell:
 *  - <768  (phone):  rail = drawer (hamburger), sidebar = drawer (drill-in)
 *  - 768–959 (small desktop): rail = compact static icon column.
 *    Page-owned sidebars stay static here, so the business navigator does not
 *    disappear just because the app is in a partial-width browser window.
 *  - 960–1279 (narrow desktop): rail keeps text labels in a slimmer column.
 *  - ≥1280 (roomy desktop): rail gets its full text width.
 */
const useIsDesktop = () => useMediaQuery('(min-width: 768px)') // rail static
const useHasRailText = () => useMediaQuery('(min-width: 960px)') // text rail allowed
const useHasFullRail = () => useMediaQuery('(min-width: 1280px)') // full rail width
const firstRunGuideEnabled = import.meta.env.VITE_OPENALICE_FIRST_RUN_GUIDE === '1'
const FirstRunGuide = lazy(async () => {
  const module = await import('./components/FirstRunGuide')
  return { default: module.FirstRunGuide }
})

export function App() {
  return (
    <WorkspacesProvider>
      <AppShell />
    </WorkspacesProvider>
  )
}

function AppShell() {
  return (
    <MobilePageNavigationProvider>
      <AppShellContent />
    </MobilePageNavigationProvider>
  )
}

function AppShellContent() {
  // Re-render the shell on a language switch so formatter-only subtrees
  // (charts, money/date labels that don't call t()) refresh too.
  useLocale()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mobileRailMenuButtonRef = useRef<HTMLButtonElement>(null)
  const isDesktop = useIsDesktop() // ≥768 — rail is a static column
  const hasRailText = useHasRailText() // ≥960 — text rail is allowed
  const hasFullRail = useHasFullRail() // ≥1280 — full rail width
  const railMode = !isDesktop ? 'full' : hasFullRail ? 'full' : hasRailText ? 'narrow' : 'compact'
  const location = useLocation()
  const mobilePageNavigation = useMobilePageNavigation()
  const showFirstRunGuide = firstRunGuideEnabled && !location.pathname.startsWith('/design/')

  // When the rail becomes a static column, drop its mobile drawer state.
  useEffect(() => {
    if (isDesktop) setSidebarOpen(false)
  }, [isDesktop])

  const mainContent = (
    <main className="flex flex-col min-w-0 min-h-0 bg-background h-full">
      {/* Mobile header — visible only below md */}
      <MobileContextBar
        railOpen={sidebarOpen}
        railTriggerRef={mobileRailMenuButtonRef}
        pageNavigation={mobilePageNavigation}
        openRail={() => setSidebarOpen(true)}
        closeRail={() => setSidebarOpen(false)}
      />

      <TabHost />
    </main>
  )

  return (
    <div className="flex flex-col h-full">
      {import.meta.env.VITE_DEMO_MODE && <DemoBanner />}
      {import.meta.env.VITE_DEMO_MODE && <DemoAnalytics />}
      <UpdateBanner />
      <DesktopUpdatePrompt />
      <div className="flex flex-1 min-h-0">
        <ActivityBar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          desktopStatic={isDesktop}
          railMode={railMode}
          returnFocusRef={mobileRailMenuButtonRef}
        />
        <div
          aria-hidden={!isDesktop && sidebarOpen ? true : undefined}
          inert={!isDesktop && sidebarOpen ? true : undefined}
          className="flex-1 min-h-0"
        >
          {mainContent}
        </div>
        <UrlAdopter />
        {showFirstRunGuide && (
          <Suspense fallback={null}>
            <FirstRunGuide />
          </Suspense>
        )}
      </div>
    </div>
  )
}
