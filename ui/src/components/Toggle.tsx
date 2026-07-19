interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  size?: 'sm' | 'md'
  ariaLabel?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, size = 'md', ariaLabel, disabled = false }: ToggleProps) {
  const track = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-[22px]'
  const thumb = size === 'sm' ? 'w-3 h-3 bottom-[2.5px] left-[3px]' : 'w-4 h-4 bottom-[3px] left-[3px]'
  const translate = size === 'sm' ? 'translate-x-[14px]' : 'translate-x-[18px]'

  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative rounded-full transition-colors ${track} ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute rounded-full transition-all ${thumb} ${
          checked ? `${translate} bg-primary-foreground` : 'bg-muted-foreground'
        }`}
      />
    </button>
  )
}
