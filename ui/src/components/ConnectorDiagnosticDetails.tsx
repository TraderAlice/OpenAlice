import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'

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
      <summary className="oa-pressable flex min-h-10 w-fit cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground hover:text-foreground">
        <CircleAlert size={13} aria-hidden />
        {summary}
      </summary>
      <div className="mb-2 break-words pl-5 leading-5 text-destructive">
        {children}
      </div>
    </details>
  )
}
