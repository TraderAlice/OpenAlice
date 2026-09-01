interface ToggleProps {
  id?: string
  checked: boolean
  onChange: (v: boolean) => void
  size?: 'sm' | 'md'
  ariaLabel: string
  disabled?: boolean
  title?: string
}

export function Toggle({ id, checked, onChange, size = 'md', ariaLabel, disabled = false, title }: ToggleProps) {
  const track = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-[22px]'
  const thumb = size === 'sm' ? 'w-3 h-3 bottom-[2.5px] left-[3px]' : 'w-4 h-4 bottom-[3px] left-[3px]'
  const translate = size === 'sm' ? 'translate-x-[14px]' : 'translate-x-[18px]'
  // Keep the painted track compact while the native button owns a reliable
  // touch target. Negative margins preserve the former layout footprint.
  const footprint = size === 'sm' ? '-mx-1 -my-[11px]' : '-my-[9px]'

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${footprint} ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative block rounded-full transition-colors duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] motion-reduce:transition-none ${track} ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`absolute rounded-full transition-[transform,background-color] duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] motion-reduce:transition-none ${thumb} ${
            checked ? `${translate} bg-primary-foreground` : 'bg-muted-foreground'
          }`}
        />
      </span>
    </button>
  )
}
