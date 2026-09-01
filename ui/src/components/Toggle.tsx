import { Switch } from './ui/switch'

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
  return (
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={(nextChecked) => onChange(nextChecked)}
      size={size}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
    />
  )
}
