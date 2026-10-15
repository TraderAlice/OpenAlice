export function IndeterminateProgress({ label }: { label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className="h-1.5 overflow-hidden rounded-full bg-primary/15"
    >
      <div className="h-full w-full animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
    </div>
  )
}
