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
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border/70 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {leading}
          <h2 className="truncate text-[13px] font-semibold leading-[18px] tracking-[-0.01em] text-foreground">{title}</h2>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  )
}
