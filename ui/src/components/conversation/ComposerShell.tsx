import type { ReactNode } from 'react'

/** Shared geometry; callers retain their input, selectors and action semantics. */
export function ComposerShell({ context, children, controls, action, details }: {
  readonly context?: ReactNode
  readonly children: ReactNode
  readonly controls?: ReactNode
  readonly action: ReactNode
  readonly details?: ReactNode
}) {
  return (
    <div className="oa-harness-composer isolate" data-slot="conversation-composer">
      {context && <div data-testid="harness-landing-context" className="oa-harness-context-tray relative z-0 mx-[13px] -mb-3 flex min-h-12 min-w-0 items-center gap-0.5 overflow-hidden rounded-t-[20px] px-3 pb-4 pt-2 text-[12px] leading-4 text-muted-foreground">{context}</div>}
      <div data-testid="harness-composer-shell" className="oa-harness-composer-shell relative z-10 rounded-[26px] bg-card px-3 pb-2.5 pt-3">
        {children}
        <div data-testid="harness-landing-controls" className="flex min-h-8 min-w-0 items-end justify-between gap-2 px-0.5 pt-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">{controls}</div>
          {action}
        </div>
        {details}
      </div>
    </div>
  )
}
