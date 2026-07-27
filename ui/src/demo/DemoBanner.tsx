import type { ReactElement } from 'react'

export function DemoBanner(): ReactElement {
  return (
    <div className="flex min-h-8 items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 text-[12px] text-foreground sm:gap-3 sm:px-4">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
        Demo
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground sm:hidden">
        Snapshot data · Simulated AI
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:block">
        You&apos;re looking at a snapshot of OpenAlice with recorded data. Mutations don&apos;t persist; WebPi replies are simulated.
      </span>
      <a
        href="https://github.com/TraderAlice/OpenAlice"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 font-medium text-warning hover:underline"
      >
        Install →
      </a>
    </div>
  )
}
