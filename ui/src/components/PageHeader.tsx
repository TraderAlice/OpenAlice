import type { ReactNode } from 'react'
import { LiveIndicator } from './LiveIndicator'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  right?: ReactNode
  /** Show a pulsing "data is live" indicator next to the title and a
   *  relative-time microcopy ("updated 14s ago") in the description row.
   *  Pass the timestamp of the last successful refresh; pass `null` to
   *  show the pulse without a time (pre-first-load). */
  live?: { lastUpdated: Date | null }
}

export function PageHeader({ title, description, right, live }: PageHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="px-4 md:px-6 py-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-title font-bold text-text truncate">{title}</h2>
            {live && (
              <span
                className="relative inline-block w-1.5 h-1.5 rounded-full bg-green live-pulse shrink-0"
                aria-label="Live"
              />
            )}
          </div>
          {(description || live) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-muted">
              {description && <span className="min-w-0">{description}</span>}
              {live && (
                <>
                  {description && <span className="text-text-muted/40">·</span>}
                  <LiveIndicator lastUpdated={live.lastUpdated} hideDot />
                </>
              )}
            </div>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </div>
  )
}
