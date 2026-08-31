import { CheckIcon } from 'lucide-react'

/** Shared selection ink with one neutral color and fixed optical geometry. */
function SelectionCheckIcon() {
  return (
    <CheckIcon
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 text-foreground"
      strokeWidth={2.25}
    />
  )
}

export { SelectionCheckIcon }
