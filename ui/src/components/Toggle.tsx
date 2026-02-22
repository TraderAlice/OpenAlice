interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  size?: 'sm' | 'md'
}

export function Toggle({ checked, onChange, size = 'md' }: ToggleProps) {
  const track = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-[22px]'
  const thumb = size === 'sm' ? 'w-3 h-3 bottom-[2.5px] left-[3px]' : 'w-4 h-4 bottom-[3px] left-[3px]'
  const translate = size === 'sm' ? 'translate-x-[14px]' : 'translate-x-[18px]'

  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative rounded-full cursor-pointer transition-colors ${track} ${
        checked ? 'bg-green' : 'bg-bg-tertiary'
      }`}
    >
      <span
        className={`absolute rounded-full transition-all ${thumb} ${
          checked ? `${translate} bg-white` : 'bg-text-muted'
        }`}
      />
    </button>
  )
}
