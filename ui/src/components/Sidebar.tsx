import type { ReactNode } from 'react'

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
    <aside className="flex h-full w-full flex-col bg-bg-secondary">
      <div className="flex items-center justify-between px-4 h-10 shrink-0 gap-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          {leading}
          <h2 className="text-[13px] font-semibold text-text truncate">{title}</h2>
        </div>
        {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </aside>
  )
}
