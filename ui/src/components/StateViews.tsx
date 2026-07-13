import type { ReactNode } from 'react'

// ==================== Spinner ====================

interface SpinnerProps {
  size?: 'sm' | 'md'
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  const dim = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'
  return (
    <div
      className={`${dim} border-2 border-accent/20 border-t-accent rounded-full animate-spin`}
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
    <div className="flex items-center justify-center gap-2.5 py-20 text-[13px] text-text-muted">
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
      <div className="w-12 h-12 rounded-xl bg-bg-secondary border border-border/60 flex items-center justify-center text-text-muted/30 mb-4">
        {icon ?? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9h.01M15 9h.01M9 15h6" />
          </svg>
        )}
      </div>
      <p className="text-sm font-medium text-text-muted">{title}</p>
      {description && (
        <p className="text-[12px] text-text-muted/60 mt-1.5 max-w-[280px]">{description}</p>
      )}
    </div>
  )
}
