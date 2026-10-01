import type { ReactNode } from 'react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  ariaLabel?: string
  ariaControls?: string
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
  compact?: boolean
  className?: string
}

/**
 * A single visual language for small, mutually-exclusive view controls.
 * The container scrolls horizontally when labels do not fit, so data pages
 * keep the same control on phone and desktop instead of changing semantics.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  compact = false,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={([next]) => { if (next !== undefined) onChange(next) }}
      aria-label={ariaLabel}
      className={`scrollbar-hide flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border/70 bg-muted/45 p-0.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <Toggle
            key={option.value}
            value={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-controls={option.ariaControls}
            className={`shrink-0 whitespace-nowrap rounded-md font-medium outline-none transition-[background-color,color,box-shadow,scale] duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] focus-visible:[box-shadow:var(--oa-focus-shadow)] active:scale-[0.98] focus-visible:transition-none [@media(pointer:coarse)]:min-h-11 motion-reduce:transition-none ${
              compact ? 'min-h-7 px-2.5 text-xs' : 'min-h-8 px-3 text-[13px]'
            } ${
              active
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {option.label}
          </Toggle>
        )
      })}
    </ToggleGroup>
  )
}
