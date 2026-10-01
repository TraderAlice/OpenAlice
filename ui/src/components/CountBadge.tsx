import { cn } from '../lib/utils'

const countTone = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info/12 text-info',
  attention: 'bg-warning/15 text-warning',
}

export function CountBadge({ count, label, limit, tone = 'neutral', className, id }: {
  count: number
  label: string
  limit?: number
  tone?: keyof typeof countTone
  className?: string
  id?: string
}) {
  return (
    <span
      id={id}
      role="img"
      aria-label={label}
      title={label}
      data-slot="count-badge"
      className={cn('inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-[14px] tabular-nums', countTone[tone], className)}
    >
      {limit !== undefined && count > limit ? `${limit}+` : count}
    </span>
  )
}
