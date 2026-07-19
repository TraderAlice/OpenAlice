import type { ReactNode } from 'react'

/**
 * Section header used inside secondary sidebars to group rows (e.g.
 * Market's Browse/Watchlist, Portfolio's Overview/Accounts, Tracked's
 * Assets/Topics). One canonical recipe so every sidebar's group caption
 * reads the same — matches the Inbox reference date/cluster headers:
 * 10px, medium weight, uppercase, wide tracking, muted.
 *
 * Was previously copy-pasted per sidebar with drifting weight/spacing
 * (font-semibold mt-3 mb-0.5 here, font-medium mt-2 mb-1 there); this
 * collapses them to one source of truth.
 */
export function SidebarSectionHeader({
  children,
  trailing,
}: {
  children: ReactNode
  /** Optional right-aligned slot (e.g. a count). */
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 mt-2 mb-1 select-none">
      <h3 className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h3>
      {trailing}
    </div>
  )
}
