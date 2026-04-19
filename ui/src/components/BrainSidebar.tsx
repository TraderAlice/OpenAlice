import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { BrainCommit, BrainState } from '../api/brain'
import { MarkdownContent } from './MarkdownContent'

// Match DiaryPage cadence — brain changes are lower-frequency than heartbeat cycles.
const POLL_INTERVAL_MS = 60_000

type Variant = 'sidebar' | 'flat'

// ==================== Public wrapper ====================

/**
 * Brain state panel — read-only dashboard showing the current frontal-lobe
 * note with a click-to-expand history dialog for previous versions.
 *
 * Two variants:
 *   - sidebar: always-expanded, rendered as a right-side column on wide screens
 *   - flat: default-collapsed panel, rendered above the feed on narrow screens
 */
export function BrainSidebar({ variant }: { variant: Variant }) {
  const [state, setState] = useState<BrainState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const s = await api.brain.state()
      setState(s)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { fetchState() }, [fetchState])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchState()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchState])

  useEffect(() => {
    const onFocus = () => { fetchState() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchState])

  const commits = useMemo(() => state?.commits ?? [], [state])

  if (error) {
    return (
      <div className="text-[11px] text-red/80 px-3 py-2">
        Brain: {error}
      </div>
    )
  }

  return (
    <div className={variant === 'sidebar' ? 'flex flex-col gap-4' : 'flex flex-col gap-2'}>
      <FrontalLobePanel
        variant={variant}
        current={state?.frontalLobe ?? ''}
        updatedAt={commits.at(-1)?.timestamp ?? null}
        commits={commits}
      />
    </div>
  )
}

// ==================== Frontal Lobe panel ====================

function FrontalLobePanel({
  variant,
  current,
  updatedAt,
  commits,
}: {
  variant: Variant
  current: string
  updatedAt: string | null
  commits: BrainCommit[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)

  const body = current
    ? <MarkdownContent text={current} />
    : <span className="text-[12px] text-text-muted/50 italic">(empty)</span>

  // The "written Nh ago" cue lines up with what Alice sees in her own system
  // prompt, so the user can reason about the same staleness she does.
  const ageLabel = updatedAt ? formatRelativeAge(updatedAt) : null
  const subtitle = ageLabel
    ? `${commits.length} version${commits.length === 1 ? '' : 's'} · written ${ageLabel}`
    : commits.length > 0
      ? `${commits.length} version${commits.length === 1 ? '' : 's'}`
      : undefined

  return (
    <>
      <CollapsiblePanel
        variant={variant}
        title="Frontal Lobe"
        subtitle={subtitle}
        onExpand={commits.length > 0 ? () => setDialogOpen(true) : undefined}
      >
        <div className="text-[13px] leading-relaxed text-text/90">
          {body}
        </div>
      </CollapsiblePanel>
      {dialogOpen && (
        <HistoryDialog
          title="Frontal Lobe — history"
          onClose={() => setDialogOpen(false)}
        >
          {commits.slice().reverse().map((c) => (
            <article
              key={c.hash}
              className="rounded-lg border border-border/40 bg-bg-secondary/30 p-3"
            >
              <header className="text-[11px] text-text-muted/70 tabular-nums mb-2">
                {formatTimestamp(c.timestamp)}
              </header>
              <div className="text-[13px] leading-relaxed text-text/90">
                {c.stateAfter.frontalLobe
                  ? <MarkdownContent text={c.stateAfter.frontalLobe} />
                  : <span className="text-text-muted/50 italic">(empty)</span>}
              </div>
            </article>
          ))}
        </HistoryDialog>
      )}
    </>
  )
}

// ==================== CollapsiblePanel ====================

function CollapsiblePanel({
  variant,
  title,
  subtitle,
  onExpand,
  children,
}: {
  variant: Variant
  title: string
  subtitle?: string
  onExpand?: () => void
  children: ReactNode
}) {
  // On narrow screens, the panel folds by default so it doesn't steal scroll
  // space above the feed. On wide screens, the sidebar stays open.
  const [open, setOpen] = useState(variant === 'sidebar')

  return (
    <section className="rounded-xl border border-border/40 bg-bg-secondary/20 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        {variant === 'flat' ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-text hover:text-accent transition-colors"
            aria-expanded={open}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${open ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {title}
          </button>
        ) : (
          <span className="text-[12px] font-medium text-text tracking-wide">{title}</span>
        )}
        {subtitle && (
          <span className="text-[10.5px] text-text-muted/60 tabular-nums">{subtitle}</span>
        )}
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="ml-auto text-text-muted/70 hover:text-accent p-1 -m-1 rounded transition-colors"
            title="View history"
            aria-label="View history"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        )}
      </header>
      {open && <div className="px-3 py-3">{children}</div>}
    </section>
  )
}

// ==================== HistoryDialog ====================

function HistoryDialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-[14px] font-semibold text-text tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {children}
        </div>
      </div>
    </div>
  )
}

// ==================== Helpers ====================

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

/** Mirror of server-side formatter in main.ts so UI and prompt agree on staleness cue. */
function formatRelativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
