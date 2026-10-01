import type { ReactNode } from 'react'
import { LiveIndicator } from './LiveIndicator'
import { PageTopBar } from './PageTopBar'
import { ContextHelp } from './ContextHelp'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  help?: string
  accessory?: ReactNode
  right?: ReactNode
  live?: { lastUpdated: Date | null; label?: string; hideIcon?: boolean }
}

export function PageHeader({
  title,
  description,
  help,
  accessory,
  right,
  live,
}: PageHeaderProps) {
  return (
    <>
      <PageTopBar heading="page" title={title} actions={right}>
        {accessory}
        {help && <ContextHelp label={title}>{help}</ContextHelp>}
      </PageTopBar>
      {(description || live) && (
        <div data-slot="page-description" className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-[var(--page-inset)] pb-1 pt-3 text-sm leading-5 text-muted-foreground">
          {description && <span className="min-w-0">{description}</span>}
          {live && <LiveIndicator lastUpdated={live.lastUpdated} label={live.label} hideIcon={live.hideIcon} />}
        </div>
      )}
    </>
  )
}
