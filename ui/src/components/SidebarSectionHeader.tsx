import type { ReactNode } from 'react'

/**
 * Canonical group caption for secondary sidebars. Sentence case, restrained
 * weight, and one optical inset keep grouped navigation calm and scannable.
 */
export function SidebarSectionHeader({
  children,
  trailing,
  hierarchy = false,
}: {
  children: ReactNode
  /** Optional right-aligned slot (e.g. a count). */
  trailing?: ReactNode
  /** Parent title above indented navigation, rather than a muted caption. */
  hierarchy?: boolean
}) {
  return (
    <div className="mb-1 mt-3 flex min-h-5 select-none items-center gap-1.5 px-4">
      <h3 className={`flex-1 truncate font-medium ${hierarchy ? 'text-[13px] leading-[18px] text-sidebar-foreground' : 'text-[11px] leading-4 text-muted-foreground'}`}>
        {children}
      </h3>
      {trailing && <span className="flex shrink-0 items-center leading-4">{trailing}</span>}
    </div>
  )
}
