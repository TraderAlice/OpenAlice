import { useEffect, useState } from 'react'
import { useWorkspace } from '../tabs/store'
import { type Tab } from '../tabs/types'
import { getView } from '../tabs/registry'
import { TabStrip } from './TabStrip'
import { EmptyEditor } from './EmptyEditor'

/**
 * Main content host.
 *
 * Tabs are now lightweight navigation history, not VS-Code-style runtime
 * containers. By default only the active tab is mounted; inactive tabs keep
 * their ViewSpec in the tab store but release component state, timers, charts,
 * terminals, and other DOM-owned resources. A view can opt into
 * `lifecycle: 'keep-mounted'` in tabs/registry when it genuinely needs a live
 * background DOM. Those keep-mounted hidden frames use `visibility: hidden`
 * so size-sensitive children keep a real layout box.
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
    <div className="flex flex-col flex-1 min-h-0">
      <TabStrip />
      <div className="relative flex-1 min-h-0">
        {tabIds.length === 0 ? (
          <EmptyEditor />
        ) : (
          tabIds.map((id) => {
            const tab = tabsMap[id]
            if (!tab) return null
            const isActive = id === activeTabId
            const view = getView(tab.spec.kind)
            const keepMounted = view.lifecycle === 'keep-mounted'
            // Mobile: only render the active tab to avoid blowing memory and
            // because we don't even have a strip to switch tabs from.
            if (!isActive && (!isDesktop || !keepMounted)) return null
            return <TabFrame key={id} tab={tab} visible={isActive} />
          })
        )}
      </div>
    </div>
  )
}

/** One mounted view frame. Hidden frames exist only for keep-mounted views. */
function TabFrame({ tab, visible }: { tab: Tab; visible: boolean }) {
  const view = getView(tab.spec.kind)
  // Cast: each ViewModule has a Component constrained to its spec kind. The
  // map lookup loses that narrowing; the runtime type matches by construction.
  const Component = view.Component as React.ComponentType<{ spec: typeof tab.spec; visible: boolean }>
  return (
    <div
      data-view-frame={tab.spec.kind}
      data-view-visible={visible ? 'true' : 'false'}
      className="absolute inset-0 flex flex-col min-h-0"
      style={{
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: visible ? 1 : 0,
      }}
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
