import type { ReactNode } from 'react'
import { SelectionIndicator } from './SelectionIndicator'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface SidebarRowProps {
  /** Row label. ReactNode supports sigils such as `#` for chat channels. */
  label: ReactNode
  /** Whether the row is the currently-active item in this sidebar. */
  active?: boolean
  /** Click handler for the row body. Trailing actions should `stopPropagation`. */
  onClick: () => void
  /**
   * Optional leading glyph. Callers provide the styled node and the row owns
   * its fixed optical slot.
   */
  icon?: ReactNode
  /**
   * Right-aligned content slot — status badges, counts, hover-revealed
   * action buttons. The row uses `group` so consumers can apply
   * `opacity-0 group-hover:opacity-100` to reveal-on-hover affordances.
   */
  trail?: ReactNode
  /** Optional native tooltip for the whole row (e.g. an entity description). */
  title?: string
  /** Optional disabled / dimmed presentation, e.g. for off-by-default rows. */
  dim?: boolean
  /** Disclosure state when the row controls a collapsible child group. */
  ariaExpanded?: boolean
  /** Id of the collapsible child group controlled by this row. */
  ariaControls?: string
}

/**
 * Standardised row used inside every secondary sidebar (Chat channels,
 * Settings categories, Dev tabs, Portfolio accounts, etc.).
 *
 * Visual contract:
 * - Inactive rows render in full text colour for fast navigation scanning.
 * - Active rows use a muted fill and the project-owned neutral selection mark.
 * - Hover state is a half-opacity tint of the active background.
 *
 * The `div role="button"` owns row activation and lets `trail` contain action
 * buttons within valid HTML.
 * Enter / Space activate the row for keyboard users.
 */
export function SidebarRow({
  label,
  active = false,
  onClick,
  icon,
  trail,
  title,
  dim = false,
  ariaExpanded,
  ariaControls,
}: SidebarRowProps) {
  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`oa-nav-row group relative mx-2 flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-[18px] outline-none md:min-h-8 ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
      } ${dim ? 'opacity-60' : ''}`}
    >
      {active && <SelectionIndicator />}
      {icon && <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">{icon}</span>}
      <span className="truncate flex-1">{label}</span>
      {trail && <div className="shrink-0 flex items-center gap-0.5">{trail}</div>}
    </div>
  )
  if (!title) return row
  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipContent side="right" sideOffset={8}>{title}</TooltipContent>
    </Tooltip>
  )
}
