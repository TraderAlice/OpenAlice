import { useEffect, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { TabHost } from './components/TabHost'
import { UpdateBanner } from './components/UpdateBanner'
import { DemoBanner } from './demo/DemoBanner'
import { DemoAnalytics } from './demo/DemoAnalytics'
import { WorkspacesProvider } from './contexts/WorkspacesContext'
import { UrlAdopter } from './tabs/UrlAdopter'
import { useLocale } from './i18n/useLocale'

/**
 * Activity-bar pages — only items that appear as icons in the ActivityBar.
 * Each maps to one or more tab kinds via tabs/registry.ts (defaultSpecForActivity).
 */
export type Page =
  | 'chat' | 'inbox' | 'tracked' | 'workspaces' | 'portfolio' | 'news' | 'automation' | 'market'
  | 'issue'
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
 * Three breakpoints drive the responsive shell:
 *  - <768  (phone):  rail = drawer (hamburger), sidebar = drawer (drill-in)
 *  - 768–1179 (narrow desktop): rail = compact static icon column.
 *    Page-owned sidebars stay static here, so the business navigator does not
 *    disappear just because the app is in a partial-width browser window.
 *  - ≥1180 (roomy desktop): rail can expand to text labels.
 */
const useIsDesktop = () => useMediaQuery('(min-width: 768px)') // rail static
const useIsRoomy = () => useMediaQuery('(min-width: 1180px)') // text rail allowed

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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isDesktop = useIsDesktop() // ≥768 — rail is a static column
  const isRoomy = useIsRoomy() // ≥1180 — full text rail is allowed

  // When the rail becomes a static column, drop its mobile drawer state.
  useEffect(() => {
    if (isDesktop) setSidebarOpen(false)
  }, [isDesktop])

  // Lock body scroll while a drawer is open so the page behind doesn't drift
  // under the backdrop. Restores the previous value on close/unmount.
  useEffect(() => {
    if (!sidebarOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [sidebarOpen])

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
          desktopStatic={isDesktop}
          compactRailForced={isDesktop && !isRoomy}
        />
        <div className="flex-1 min-h-0">
          {mainContent}
        </div>
        <UrlAdopter />
      </div>
    </div>
  )
}
