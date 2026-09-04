import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PrimaryNavigationContext } from '../contexts/PrimaryNavigationContext'

/** Shared geometry, not business navigation. Nested tool panels may reuse it
 * locally; page headers use PageTopBar to occupy the layout's fixed slot. */
export function TopBar({ title, titleHint, leading, actions, children }: {
  title?: ReactNode
  titleHint?: string
  leading?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div data-slot="page-topbar" className="oa-topbar">
      {leading && <div className="oa-topbar-leading">{leading}</div>}
      <div className="oa-topbar-identity" title={titleHint ?? (typeof title === 'string' ? title : undefined)}>
        {title != null && <h2 className="truncate text-sm font-semibold tracking-[-0.01em]">{title}</h2>}
        {children}
      </div>
      {actions && <div className="oa-topbar-actions">{actions}</div>}
    </div>
  )
}

const HeaderSlot = createContext<{
  target: HTMLDivElement | null
  leading?: ReactNode
  claim: () => () => void
} | null>(null)

/** Portals retain the page's React context and handlers. The local claim only
 * hides the fallback; it never copies business callbacks or view state. */
export function PageTopBar(props: Parameters<typeof TopBar>[0]) {
  const slot = useContext(HeaderSlot)
  const primaryNavigation = useContext(PrimaryNavigationContext)
  const claim = slot?.claim
  useLayoutEffect(() => claim?.(), [claim])
  const bar = <TopBar {...props} leading={<>{slot ? slot.leading : primaryNavigation}{props.leading}</>} />
  if (!slot) return bar
  return slot.target ? createPortal(bar, slot.target) : null
}

export function PageContentLayout({ title, leading, children }: {
  title: string
  leading?: ReactNode
  children: ReactNode
}) {
  const primaryNavigation = useContext(PrimaryNavigationContext)
  const headerLeading = <>{primaryNavigation}{leading}</>
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [headers, setHeaders] = useState(0)
  const claim = useCallback(() => {
    setHeaders((count) => count + 1)
    return () => setHeaders((count) => count - 1)
  }, [])
  return (
    <HeaderSlot.Provider value={{ target, leading: headerLeading, claim }}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div className="oa-topbar-host shrink-0">
          <div ref={setTarget} className="oa-topbar-slot" />
          {headers === 0 && <TopBar title={title} leading={headerLeading} />}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </HeaderSlot.Provider>
  )
}
