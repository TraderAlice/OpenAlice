import { useEffect, useState } from 'react'
import { useWorkspace } from '../tabs/store'
import { type Tab } from '../tabs/types'
import { getView } from '../tabs/registry'
import { TabStrip } from './TabStrip'
import { EmptyEditor } from './EmptyEditor'

/**
 * The main editor area — replaces the old `<Routes>` block.
 *
 * Renders every open tab in the focused group concurrently, hiding all but
 * the active one via CSS `display: none`. Reasoning:
 *
 * - Tabs that hold long-lived state (ChatPage's SSE / message buffers,
 *   in-progress charts) survive switching without re-fetch or re-mount.
 * - Components don't need to be aware of "tab-hosted vs route-hosted" —
 *   they just render normally; the host controls visibility.
 *
 * The `visible` prop threaded into each tab's component lets surfaces that
 * care (ChatPage's catch-up scroll) react to becoming visible.
 *
 * Mobile (< md): single-tab mode. Only the active tab renders, no strip.
 */
export function TabHost() {
  const tabIds = useWorkspace((state) =>
    state.tree.kind === 'leaf' ? state.tree.group.tabIds : [],
  )
  const activeTabId = useWorkspace((state) =>
    state.tree.kind === 'leaf' ? state.tree.group.activeTabId : null,
  )
  const tabsMap = useWorkspace((state) => state.tabs)
  const isDesktop = useIsDesktop()

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-bg p-3">
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-xl border border-border/80 bg-[#0a0a0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
        <TabStrip />
        <div className="relative flex-1 min-h-0">
          {tabIds.length === 0 ? (
            <EmptyEditor />
          ) : (
            tabIds.map((id) => {
              const tab = tabsMap[id]
              if (!tab) return null
              const isActive = id === activeTabId
              // Mobile: only render the active tab to avoid blowing memory and
              // because we don't even have a strip to switch tabs from.
              if (!isDesktop && !isActive) return null
              return <TabFrame key={id} tab={tab} visible={isActive} />
            })
          )}
        </div>
      </div>
    </div>
  )
}

/** One mounted tab. Hidden frames are kept in the DOM but `display: none`. */
function TabFrame({ tab, visible }: { tab: Tab; visible: boolean }) {
  const view = getView(tab.spec.kind)
  // Cast: each ViewModule has a Component constrained to its spec kind. The
  // map lookup loses that narrowing; the runtime type matches by construction.
  const Component = view.Component as React.ComponentType<{ spec: typeof tab.spec; visible: boolean }>
  return (
    <div
      className="absolute inset-0 flex flex-col min-h-0"
      style={{ display: visible ? 'flex' : 'none' }}
      aria-hidden={!visible}
      // `inert` keeps focusable elements in hidden frames out of tab order.
      // React 19 supports it as a JSX attribute.
      inert={!visible}
    >
      <Component spec={tab.spec} visible={visible} />
    </div>
  )
}

/** Desktop = md+ in Tailwind = ≥768px. Phase 1 mobile is single-tab mode. */
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
