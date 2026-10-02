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
      className={`scrollbar-hide flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-secondary p-0.5 ${className}`}
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
            className={`oa-segmented-option shrink-0 whitespace-nowrap rounded-md font-medium outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)] [@media(pointer:coarse)]:min-h-11 ${
              compact ? 'min-h-7 px-2.5 text-sm' : 'min-h-8 px-3 text-sm'
            } ${
              active
                ? 'text-background'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            {option.label}
          </Toggle>
        )
      })}
    </ToggleGroup>
  )
}
