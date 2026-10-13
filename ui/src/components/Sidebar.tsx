import type { ReactNode } from 'react'
import { TopBar } from './PageTopBar'

interface SidebarProps {
  /** Header title — shown at the top of the sidebar (e.g. "CHAT", "SETTINGS"). */
  title: string
  /** Optional action buttons rendered right-aligned in the header (e.g. "+ new"). */
  actions?: ReactNode
  /** Scrollable body content — usually the activity-specific navigator (channel list, file tree, etc.). */
  children: ReactNode
  /** Optional left-aligned leading slot in the header (e.g. mobile back arrow). */
  leading?: ReactNode
}

/**
 * Page sidebar chrome. Hosts the surface-specific navigator while the owning
 * page layout decides whether it is static, resizable, or a mobile drawer.
 */
export function Sidebar({ title, actions, children, leading }: SidebarProps) {
  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <TopBar title={title} leading={leading} actions={actions} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  )
}
