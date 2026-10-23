import { DetailsSummary } from './ui/collapsible'
import type { ReactNode } from 'react'

export function ConnectorDiagnosticDetails({
  summary,
  children,
}: {
  summary: string
  children: ReactNode
}) {
  return (
    <details
      data-connector-diagnostic-details
      className="group/details mt-3 border-t border-border/60 pt-1 text-[11.5px]"
    >
      <DetailsSummary>
        {summary}
      </DetailsSummary>
      <div className="mb-2 break-words leading-5 text-destructive">
        {children}
      </div>
    </details>
  )
}
