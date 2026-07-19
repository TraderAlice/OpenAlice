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
  in_progress: { label: 'In Progress', Icon: CircleDot, className: 'text-warning' },
  todo: { label: 'Todo', Icon: Circle, className: 'text-muted-foreground' },
  backlog: { label: 'Backlog', Icon: CircleDashed, className: 'text-muted-foreground/60' },
  done: { label: 'Done', Icon: CheckCircle2, className: 'text-success' },
  canceled: { label: 'Canceled', Icon: XCircle, className: 'text-muted-foreground/50' },
}
