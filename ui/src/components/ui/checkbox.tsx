import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { SelectionCheckIcon } from './selection-check-icon'

function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <span className={cn('relative inline-flex h-11 w-5 shrink-0 items-center justify-center align-middle', className)}>
      <input
        {...props}
        type="checkbox"
        className="peer absolute top-0 -left-3 z-10 m-0 h-full w-11 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span aria-hidden className="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded-sm border border-input bg-background transition-[border-color,background-color] duration-[var(--motion-fast)] peer-checked:border-foreground peer-checked:bg-secondary peer-focus-visible:[box-shadow:var(--oa-focus-shadow)] peer-disabled:opacity-40 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100 motion-reduce:transition-none">
        <SelectionCheckIcon />
      </span>
    </span>
  )
}

export { Checkbox }
