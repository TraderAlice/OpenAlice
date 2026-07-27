import { useEffect, useState } from 'react'
import { useWorkspace } from '../tabs/store'
import { type Tab } from '../tabs/types'
import { getView, getViewShell } from '../tabs/registry'
import { EmptyEditor } from './EmptyEditor'
import { ChatPageShell } from '../pages/ChatPageShell'

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
  const activeTab = activeTabId ? tabsMap[activeTabId] ?? null : null
  const activeView = activeTab ? getView(activeTab.spec.kind) : null
  const activeUsesPersistentFrame = activeView?.lifecycle === 'keep-mounted' && isDesktop
  const persistentTabs = isDesktop
    ? tabIds
      .map((id) => tabsMap[id])
      .filter((tab): tab is Tab => tab != null && getView(tab.spec.kind).lifecycle === 'keep-mounted')
    : []

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 min-w-0 flex-1">
        {tabIds.length === 0 ? (
          <EmptyEditor />
        ) : (
          <>
            {/* Active-only views share one unkeyed slot. Moving between two
                views with the same product shell replaces only the content;
                the shell (notably Ask Alice's navigator) stays mounted. */}
            {activeTab && !activeUsesPersistentFrame && (
              <TabFrame tab={activeTab} visible />
            )}
            {/* Desktop keep-mounted views retain their keyed frame across
                focus changes. Mobile still renders only its active view. */}
            {persistentTabs.map((tab) => (
              <TabFrame key={tab.id} tab={tab} visible={tab.id === activeTabId} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** One mounted view frame. Hidden frames exist only for keep-mounted views. */
function TabFrame({ tab, visible }: { tab: Tab; visible: boolean }) {
  const view = getView(tab.spec.kind)
  const shell = getViewShell(tab.spec)
  // Cast: each ViewModule has a Component constrained to its spec kind. The
  // map lookup loses that narrowing; the runtime type matches by construction.
  const Component = view.Component as React.ComponentType<{ spec: typeof tab.spec; visible: boolean }>
  return (
    <div
      data-view-frame={tab.spec.kind}
      data-view-visible={visible ? 'true' : 'false'}
      className={`absolute inset-0 flex min-h-0 min-w-0 flex-col ${visible ? 'oa-view-enter' : ''}`}
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
      {shell === 'chat' ? (
        <ChatPageShell>
          <Component key={tab.id} spec={tab.spec} visible={visible} />
        </ChatPageShell>
      ) : (
        <Component key={tab.id} spec={tab.spec} visible={visible} />
      )}
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
