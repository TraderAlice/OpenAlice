import type { ReactNode } from 'react'

interface SidebarRowProps {
  /** Row label. ReactNode so callers can prepend sigils like `#` for chat channels. */
  label: ReactNode
  /** Whether the row is the currently-active item in this sidebar. */
  active?: boolean
  /** Click handler for the row body. Trailing actions should `stopPropagation`. */
  onClick: () => void
  /**
   * Optional leading glyph (shrink-0), e.g. an entity-type icon. Pass the
   * fully-styled node — the row doesn't impose a size or colour so callers
   * keep control (e.g. `<TrendingUp size={13} className="text-muted-foreground/70" />`).
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
}

/**
 * Standardised row used inside every secondary sidebar (Chat channels,
 * Settings categories, Dev tabs, Portfolio accounts, etc.).
 *
 * Visual contract:
 * - Inactive rows render in full text colour, not muted, so they read as
 *   navigation items rather than paragraph copy.
 * - Active rows get a tinted background AND a 2px accent bar on the left
 *   edge — the bar makes "selected" unmistakable even at a glance.
 * - Hover state is a half-opacity tint of the active background.
 *
 * The element is a `div role="button"` rather than `<button>` so callers
 * can nest action buttons inside `trail` (HTML disallows nested buttons).
 * Enter / Space activate the row for keyboard users.
 */
export function SidebarRow({ label, active = false, onClick, icon, trail, title, dim = false }: SidebarRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      title={title}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`oa-nav-row group relative flex min-h-10 items-center gap-1.5 px-3 py-2 text-[13px] cursor-pointer outline-none focus-visible:bg-muted/70 ${
        active
          ? 'bg-muted text-foreground'
          : 'text-foreground hover:bg-muted/50'
      } ${dim ? 'opacity-60' : ''}`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary"
        />
      )}
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      <span className="truncate flex-1">{label}</span>
      {trail && <div className="shrink-0 flex items-center gap-0.5">{trail}</div>}
    </div>
  )
}
