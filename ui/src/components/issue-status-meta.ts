import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IssueStatus } from '../api/issues'

export interface StatusMeta {
  label: string
  Icon: LucideIcon
  /** Icon tint. */
  className: string
}

export const STATUS_META: Record<IssueStatus, StatusMeta> = {
  in_progress: { label: 'In Progress', Icon: CircleDot, className: 'text-[var(--color-issue-status-meta-warning-text)]' },
  todo: { label: 'Todo', Icon: Circle, className: 'text-muted' },
  backlog: { label: 'Backlog', Icon: CircleDashed, className: 'text-muted/60' },
  done: { label: 'Done', Icon: CheckCircle2, className: 'text-[var(--color-issue-status-meta-success-text)]' },
  canceled: { label: 'Canceled', Icon: XCircle, className: 'text-muted/50' },
}
