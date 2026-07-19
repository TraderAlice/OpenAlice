import type { SaveStatus } from '../hooks/useAutoSave'

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  if (status === 'idle') return null

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] shrink-0">
      {status === 'saving' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-muted-foreground">Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          <span className="text-muted-foreground">Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
          <span className="text-destructive">Save failed</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-destructive underline underline-offset-2 hover:text-foreground ml-0.5"
            >
              Retry
            </button>
          )}
        </>
      )}
    </span>
  )
}
