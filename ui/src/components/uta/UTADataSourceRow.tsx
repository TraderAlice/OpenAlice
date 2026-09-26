import type { ReactNode } from 'react'
import { Toggle } from '../Toggle'

export function UTADataSourceRow({
  name,
  description,
  checked,
  disabled = false,
  onChange,
  status,
  ariaLabel,
}: {
  name: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  status?: ReactNode
  ariaLabel?: string
}) {
  return <div className="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
    <div className="min-w-0">
      <div className="text-[12px] font-medium text-foreground">{name}</div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {status}
      <Toggle
        ariaLabel={ariaLabel ?? `${name} K-line source`}
        size="sm"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  </div>
}
