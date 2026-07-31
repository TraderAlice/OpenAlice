import type { ReactNode } from 'react'
import { LiveIndicator } from './LiveIndicator'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  right?: ReactNode
  /** Move a substantial action group below the title when this header's own
   *  content pane is narrow. Uses a container query rather than the browser
   *  viewport so app and local sidebars are accounted for. */
  stackActionsOnNarrow?: boolean
  /** Show a pulsing "data is live" indicator next to the title and a
   *  relative-time microcopy ("updated 14s ago") in the description row.
   *  Pass the timestamp of the last successful refresh; pass `null` to
   *  show the pulse without a time (pre-first-load). */
  live?: { lastUpdated: Date | null }
}

export function PageHeader({
  title,
  description,
  right,
  stackActionsOnNarrow = false,
  live,
}: PageHeaderProps) {
  return (
    <div
      className="shrink-0 border-b border-border"
      style={stackActionsOnNarrow ? { containerType: 'inline-size' } : undefined}
    >
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 md:gap-4 md:px-6 md:py-5 ${
          stackActionsOnNarrow ? 'oa-page-header-stack-actions' : ''
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-title font-bold text-foreground truncate">{title}</h2>
            {live && (
              <span
                className="relative inline-block w-1.5 h-1.5 rounded-full bg-success live-pulse shrink-0"
                aria-label="Live"
              />
            )}
          </div>
          {(description || live) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
              {description && <span className="min-w-0">{description}</span>}
              {live && (
                <>
                  {description && <span className="text-muted-foreground/40">·</span>}
                  <LiveIndicator lastUpdated={live.lastUpdated} hideDot />
                </>
              )}
            </div>
          )}
        </div>
        {right && (
          <div className={`shrink-0 ${stackActionsOnNarrow ? 'oa-page-header-actions' : ''}`}>
            {right}
          </div>
        )}
      </div>
    </div>
  )
}
