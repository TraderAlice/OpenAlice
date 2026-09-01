/** Project-owned selection mark with one fixed, neutral optical geometry. */
export function SelectionIndicator() {
  return (
    <span
      aria-hidden="true"
      data-selection-indicator=""
      className="pointer-events-none absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-r-full bg-sidebar-foreground/65"
    />
  )
}
