import type { ComponentProps, ReactNode } from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inputClass } from '../form'
import { choicePopupClass, choiceListClass, choiceItemClass } from './choice-styles'
import { SelectionCheckIcon } from './selection-check-icon'

interface SelectOption {
  value: string
  label: string
  icon?: ReactNode
  disabled?: boolean
}

interface SelectProps extends Omit<ComponentProps<'button'>, 'value' | 'defaultValue' | 'onChange' | 'children'> {
  size?: 'default' | 'sm'
  value: string
  options: readonly SelectOption[]
  onValueChange: (value: string) => void
  name?: string
  required?: boolean
  placeholder?: string
}

function Select({
  value,
  options,
  onValueChange,
  disabled,
  id,
  name,
  form,
  required,
  className,
  size = 'default',
  placeholder = '—',
  ...props
}: SelectProps) {
  const selected = options.find((option) => option.value === value)
  const hasIcons = options.some((option) => option.icon)

  return (
    <SelectPrimitive.Root
      value={value}
      items={options}
      onValueChange={(next) => { if (next !== null) onValueChange(next) }}
      disabled={disabled || options.length === 0}
      id={id}
      name={name}
      form={form}
      required={required}
    >
      <SelectPrimitive.Trigger
        {...props}
        data-slot="select-trigger"
        className={cn(inputClass, 'group/select inline-flex items-center gap-3 text-start [@media(pointer:coarse)]:min-h-11', size === 'sm' ? 'h-8 py-1 text-sm leading-5' : 'h-(--oa-control-height) py-1.5 text-sm leading-5 [@media(pointer:coarse)]:text-base', className)}
      >
        {hasIcons && <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">{selected?.icon}</span>}
        <SelectPrimitive.Value className="min-w-0 flex-1 truncate" title={selected?.label} placeholder={placeholder}>{selected?.label ?? placeholder}</SelectPrimitive.Value>
        <SelectPrimitive.Icon className="flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-transform duration-[var(--motion-fast)] group-data-popup-open/select:rotate-180 motion-reduce:transition-none">
          <ChevronDown className="size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner align="start" sideOffset={6} collisionPadding={16} alignItemWithTrigger={false} className="isolate z-50 outline-none">
          <SelectPrimitive.Popup
            data-slot="select-content"
            className={cn(choicePopupClass, size === 'sm'
              ? 'w-max min-w-[min(var(--anchor-width),var(--available-width))] max-w-[min(32rem,var(--available-width))]'
              : 'w-(--anchor-width) max-w-(--available-width)')}
          >
            <SelectPrimitive.List className={choiceListClass}>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                  className={choiceItemClass}
                >
                  {hasIcons && <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">{option.icon}</span>}
                  <SelectPrimitive.ItemText className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{option.label}</SelectPrimitive.ItemText>
                  <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                    <SelectPrimitive.ItemIndicator><SelectionCheckIcon /></SelectPrimitive.ItemIndicator>
                  </span>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export { Select }
