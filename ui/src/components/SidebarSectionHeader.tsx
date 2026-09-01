import type { ReactNode } from 'react'

/**
 * Canonical group caption for secondary sidebars. Sentence case, restrained
 * weight, and one optical inset keep grouped navigation calm and scannable.
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
    <div className="mb-1 mt-3 flex select-none items-center gap-1.5 px-4">
      <h3 className="flex-1 truncate text-[11px] font-medium text-muted-foreground">
        {children}
      </h3>
      {trailing}
    </div>
  )
}
