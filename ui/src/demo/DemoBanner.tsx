import type { ReactElement } from 'react'

export function DemoBanner(): ReactElement {
  return (
    <div className="flex min-h-8 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 text-[12px] text-text sm:gap-3 sm:px-4">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        Demo
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-text-muted sm:hidden">
        Snapshot data · Read-only
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-text-muted sm:block">
        You&apos;re looking at a snapshot of OpenAlice with recorded data. Mutations don&apos;t persist; the agent terminal is replayed.
      </span>
      <a
        href="https://github.com/TraderAlice/OpenAlice"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 font-medium text-amber-700 hover:underline dark:text-amber-300"
      >
        Install →
      </a>
    </div>
  )
}
