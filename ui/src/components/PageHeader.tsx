import type { ReactNode } from 'react'
import { LiveIndicator } from './LiveIndicator'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  right?: ReactNode
  /** Move a substantial action group below the title when this header's own
   *  content pane is narrow. The container query includes app and local
   *  sidebar geometry. */
  stackActionsOnNarrow?: boolean
  /** Show a pulsing "data is live" indicator next to the title and a
   *  relative-time microcopy ("updated 14s ago") in the description row.
   *  Pass the timestamp of the last successful refresh. `null` keeps the live
   *  state visible before the first refresh completes. */
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
      className="shrink-0 border-b border-border/60"
      style={stackActionsOnNarrow ? { containerType: 'inline-size' } : undefined}
    >
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 md:gap-4 md:px-6 md:py-4 ${
          stackActionsOnNarrow ? 'oa-page-header-stack-actions' : ''
        }`}
      >
        <div className="min-w-0">
          <h2 className="truncate text-title font-semibold tracking-[-0.012em] text-foreground">{title}</h2>
          {(description || live) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
              {description && <span className="min-w-0">{description}</span>}
              {live && <LiveIndicator lastUpdated={live.lastUpdated} />}
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
