import type { ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  ariaLabel?: string
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
    <div
      role="group"
      aria-label={ariaLabel}
      className={`scrollbar-hide flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border/70 bg-bg-tertiary/60 p-0.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={`shrink-0 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow] ${
              compact ? 'min-h-6 px-2 text-[10px]' : 'min-h-7 px-2.5 text-[11px]'
            } ${
              active
                ? 'bg-bg text-accent shadow-sm ring-1 ring-border/60'
                : 'text-text-muted hover:bg-overlay hover:text-text'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
