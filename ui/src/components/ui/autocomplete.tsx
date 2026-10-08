import type { ComponentProps } from 'react'
import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete'
import { cn } from '@/lib/utils'
import { inputClass } from '../form'
import { choicePopupClass, choiceListClass, choiceItemClass } from './choice-styles'

interface AutocompleteProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'list' | 'size'> {
  value: string
  options: readonly string[]
  onValueChange: (value: string) => void
}

function Autocomplete({ value, options, onValueChange, disabled, className, ...props }: AutocompleteProps) {
  return (
    <AutocompletePrimitive.Root items={options} value={value} onValueChange={onValueChange} disabled={disabled} openOnInputClick>
      <AutocompletePrimitive.Input {...props} className={cn(inputClass, '[@media(pointer:coarse)]:min-h-11', className)} />
      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner align="start" sideOffset={6} collisionPadding={16} className="isolate z-50">
          <AutocompletePrimitive.Popup data-slot="autocomplete-content" className={cn(choicePopupClass, 'w-max min-w-[min(var(--anchor-width),var(--available-width))] max-w-[min(32rem,var(--available-width))] data-empty:hidden')}>
            <AutocompletePrimitive.List className={choiceListClass}>
              {(option: string) => (
                <AutocompletePrimitive.Item key={option} value={option} className={choiceItemClass}>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option}</span>
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  )
}

export { Autocomplete }
