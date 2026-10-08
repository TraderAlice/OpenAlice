import { useState } from 'react'
import { Autocomplete } from '@base-ui/react/autocomplete'
import { ChevronDown } from 'lucide-react'
import { inputClass } from '../form'
import type { LabeledOption } from '../../lib/presetHelpers'
import { AIProviderIcon } from '../../lib/aiProviderIcon'
import { modelDisplayName, modelManufacturer } from '../../lib/modelIdentity'
import { ModelIdentity } from '../ModelIdentity'
import { SelectionCheckIcon } from '../ui/selection-check-icon'
import { choicePopupClass, choiceListClass, choiceItemClass } from '../ui/choice-styles'

export function ModelCombobox({ value, suggestions, onChange, placeholder, ariaLabel, suggestionsLabel, vendor }: {
  value: string
  vendor?: string | null
  suggestions: readonly LabeledOption[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  suggestionsLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [editing, setEditing] = useState(false)
  const selected = suggestions.find((model) => model.id === value)
  const displayValue = selected && !editing ? modelDisplayName(value, selected.label) : value
  const matches = (model: LabeledOption, query: string) => !filtering || `${model.id} ${modelDisplayName(model.id, model.label)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  return <Autocomplete.Root
    items={suggestions}
    value={displayValue}
    onValueChange={(nextValue, details) => {
      setFiltering(details.reason === 'input-change')
      onChange(nextValue)
    }}
    open={open && suggestions.some((model) => matches(model, displayValue))}
    onOpenChange={(nextOpen, details) => {
      setOpen(nextOpen)
      if (!nextOpen || details.reason === 'trigger-press') setFiltering(false)
    }}
    itemToStringValue={(model: LabeledOption) => model.id}
    filter={matches}
    autoHighlight
    openOnInputClick
  >
    <Autocomplete.InputGroup className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
        <AIProviderIcon vendor={modelManufacturer(value, vendor)} className="size-4 shrink-0" />
      </span>
      <Autocomplete.Input
        aria-label={ariaLabel ?? placeholder ?? 'Model'}
        className={`${inputClass} pl-9 pr-10`}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
      />
      {suggestions.length > 0 && <Autocomplete.Trigger aria-label={suggestionsLabel ?? 'Show model suggestions'} className="group absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-4 transition-transform duration-[var(--motion-fast)] group-data-popup-open:rotate-180 motion-reduce:transition-none" />
      </Autocomplete.Trigger>}
    </Autocomplete.InputGroup>
    <Autocomplete.Portal>
      <Autocomplete.Positioner align="start" sideOffset={6} collisionPadding={16} className="isolate z-50">
        <Autocomplete.Popup data-slot="autocomplete-content" className={`${choicePopupClass} w-max min-w-[min(var(--anchor-width),var(--available-width))] max-w-[min(32rem,var(--available-width))] data-empty:hidden`}>
          <Autocomplete.List aria-label={suggestionsLabel ?? 'Model suggestions'} className={choiceListClass}>
            {(model: LabeledOption) => <Autocomplete.Item key={model.id} value={model} aria-selected={model.id === value} className={choiceItemClass}>
              <ModelIdentity model={model.id} label={model.label} vendor={vendor} className="flex-1" />
              <span className="size-4 shrink-0">{model.id === value && <SelectionCheckIcon />}</span>
            </Autocomplete.Item>}
          </Autocomplete.List>
        </Autocomplete.Popup>
      </Autocomplete.Positioner>
    </Autocomplete.Portal>
  </Autocomplete.Root>
}
