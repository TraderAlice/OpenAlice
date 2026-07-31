import type { ReactNode } from 'react'
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react'

// ==================== Spinner ====================

interface SpinnerProps {
  size?: 'sm' | 'md'
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  const dim = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'
  return (
    <div
      className={`${dim} border-2 border-primary/20 border-t-accent rounded-full animate-spin`}
    />
  )
}

// ==================== PageLoading ====================

export function PageLoading() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  )
}

// ==================== CenteredLoading ====================

/** A small spinner + optional label, horizontally centered with vertical
 *  breathing room. For content blocks that aren't a full-height flex column
 *  (e.g. a market board section) where `PageLoading`'s flex-1 wouldn't
 *  expand. */
export function CenteredLoading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-20 text-[13px] text-muted-foreground">
      <Spinner size="sm" />
      {label && <span>{label}</span>}
    </div>
  )
}

// ==================== Skeleton ====================

/** Theme-aware shimmer placeholder for first-load states. Size + radius come
 *  from `className` (e.g. "h-4 w-24 rounded"), so callers compose the real
 *  layout's shapes — a metric row, a table row, a chart box — out of these
 *  blocks instead of leaving a blank pane. The shimmer is the `.skeleton` class
 *  in index.css; it honors prefers-reduced-motion. Decorative → aria-hidden. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden="true" />
}

/** A stack of skeleton lines, the last one short like a paragraph tail. Handy
 *  for text blocks and list rows where you just need "some lines are loading". */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`skeleton h-3 rounded ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

/** Skeleton rows for a secondary sidebar list during cold load — matches
 *  `SidebarRow`'s `px-3 py-1.5` rhythm so the placeholder sits exactly where the
 *  real nav rows will. `icon` adds a leading glyph block (for sidebars whose rows
 *  lead with an icon, e.g. Tracked). Varied widths keep it from looking like a
 *  barcode. */
export function SidebarRowsSkeleton({ rows = 5, icon = false }: { rows?: number; icon?: boolean }) {
  const widths = ['w-32', 'w-24', 'w-28', 'w-20']
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5 px-3 py-1.5">
          {icon && <Skeleton className="h-3 w-3 rounded shrink-0" />}
          <Skeleton className={`h-3 rounded ${widths[i % widths.length]}`} />
        </div>
      ))}
    </div>
  )
}

// ==================== EmptyState ====================

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-secondary border border-border/60 flex items-center justify-center text-muted-foreground/30 mb-4">
        {icon ?? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9h.01M15 9h.01M9 15h6" />
          </svg>
        )}
      </div>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && (
        <p className="text-[12px] text-muted-foreground/60 mt-1.5 max-w-[280px]">{description}</p>
      )}
    </div>
  )
}

// ==================== RecoverySurface ====================

interface RecoverySurfaceProps {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  eyebrow?: string
  icon?: ReactNode
}

/** Full-pane error state for data that a surface cannot honestly render.
 *  The scroll owner is top-anchored, while `my-auto` preserves centering when
 *  the content fits. This keeps the heading and recovery action reachable in
 *  short desktop windows instead of centering overflow above scrollTop=0. */
export function RecoverySurface({
  title,
  description,
  actionLabel,
  onAction,
  eyebrow,
  icon,
}: RecoverySurfaceProps) {
  return (
    <div
      role="alert"
      className="flex h-full w-full items-start justify-start overflow-y-auto bg-background px-5 py-8"
    >
      <section className="mx-auto my-auto w-full max-w-lg">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/[0.08] text-destructive">
          {icon ?? <CloudOff aria-hidden className="h-6 w-6" />}
        </div>
        {eyebrow && (
          <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-destructive">
            {eyebrow}
          </p>
        )}
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
        <button
          type="button"
          onClick={onAction}
          className="btn-primary oa-pressable mt-5 inline-flex min-h-10 items-center justify-center gap-2 px-4"
        >
          <RefreshCw aria-hidden className="h-4 w-4" />
          {actionLabel}
        </button>
      </section>
    </div>
  )
}

interface RefreshNoticeProps {
  message: string
  actionLabel: string
  onAction: () => void
  className?: string
}

/** Non-blocking refresh failure for a surface that still has last-known data. */
export function RefreshNotice({
  message,
  actionLabel,
  onAction,
  className = '',
}: RefreshNoticeProps) {
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-lg border border-warning/35 bg-warning/[0.08] px-3 py-2.5 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <span className="flex min-w-0 items-start gap-2 leading-5">
        <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>{message}</span>
      </span>
      <button
        type="button"
        onClick={onAction}
        className="oa-pressable inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 self-start rounded-md px-2 text-[12px] font-medium text-foreground hover:bg-warning/10 sm:self-auto"
      >
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        {actionLabel}
      </button>
    </div>
  )
}
