import type { ReactNode } from 'react'
import { LiveIndicator } from './LiveIndicator'
import { PageTopBar } from './PageTopBar'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  right?: ReactNode
  /** Show a pulsing "data is live" indicator and relative-time microcopy
   *  ("updated 14s ago") in the description row below the toolbar.
   *  Pass the timestamp of the last successful refresh. `null` keeps the live
   *  state visible before the first refresh completes. */
  live?: { lastUpdated: Date | null }
}

export function PageHeader({
  title,
  description,
  right,
  live,
}: PageHeaderProps) {
  return (
    <>
      <PageTopBar title={title} actions={right} />
      {(description || live) && (
        <div data-slot="page-description" className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-1 pt-3 text-xs leading-4 text-muted-foreground md:px-6">
          {description && <span className="min-w-0">{description}</span>}
          {live && <LiveIndicator lastUpdated={live.lastUpdated} />}
        </div>
      )}
    </>
  )
}
