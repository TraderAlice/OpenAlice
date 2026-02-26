import type { SaveStatus } from '../hooks/useAutoSave'

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  if (status === 'idle') return null

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] shrink-0">
      {status === 'saving' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-text-muted">Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-green" />
          <span className="text-text-muted">Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-red" />
          <span className="text-red">Save failed</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-red underline underline-offset-2 hover:text-text ml-0.5"
            >
              Retry
            </button>
          )}
        </>
      )}
    </span>
  )
}
