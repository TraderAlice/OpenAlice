import { cn } from '../lib/utils'

const countTone = {
  neutral: 'bg-foreground/8 text-foreground',
  info: 'bg-info/12 text-info',
  attention: 'bg-warning/15 text-warning',
  success: 'bg-success/12 text-success',
}

export function CountBadge({ count, label, limit, tone = 'info', className, id, role = 'img' }: {
  count: number
  label: string
  limit?: number
  tone?: keyof typeof countTone
  className?: string
  id?: string
  role?: 'img' | 'status'
}) {
  return (
    <span
      id={id}
      role={role}
      aria-label={label}
      title={label}
      data-slot="count-badge"
      data-tone={tone}
      className={cn('inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-sm font-semibold leading-5 tabular-nums', countTone[tone], className)}
    >
      {limit !== undefined && count > limit ? `${limit}+` : count}
    </span>
  )
}
