import { ModelIdentity } from '../ModelIdentity'
import { AIProviderIcon } from '../../lib/aiProviderIcon'
import { modelManufacturer } from '../../lib/modelIdentity'
/**
 * Reusable preset-enumeration form controls, shared by the AI Provider
 * credential vault and the per-workspace AI config modal.
 *
 * - ModelCombobox: an editable input with an explicit suggestion popover. The
 *   suggestions come from the selected provider's model API or preset fallback.
 *   Free-typed IDs remain available for providers without a model-list API.
 */

import { useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputClass } from '../form'
import type { LabeledOption } from '../../lib/presetHelpers'

export function ModelCombobox({
  value,
  vendor,
  suggestions,
  onChange,
  placeholder,
  ariaLabel,
  suggestionsLabel,
}: {
  value: string
  vendor?: string | null
  suggestions: readonly LabeledOption[]
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  suggestionsLabel?: string
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const activeIndex = suggestions.findIndex((model) => model.id === activeModelId)
  const activeModel = suggestions[activeIndex]

  const openSuggestions = () => {
    if (suggestions.length === 0) return
    setOpen(true)
    setActiveModelId(suggestions[0]?.id ?? null)
  }

  const chooseSuggestion = (model: LabeledOption) => {
    onChange(model.id)
    setOpen(false)
    setActiveModelId(null)
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (!next || !event.currentTarget.contains(next)) {
          setOpen(false)
          setActiveModelId(null)
        }
      }}
    >
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
        <AIProviderIcon vendor={modelManufacturer(value, vendor)} className="size-4 shrink-0" />
      </span>
      <input
        ref={inputRef}
        className={`${inputClass} pl-9${suggestions.length > 0 ? ' pr-9' : ''}`}
        role="combobox"
        aria-label={ariaLabel ?? placeholder ?? 'Model'}
        aria-autocomplete="list"
        aria-controls={suggestions.length > 0 ? listId : undefined}
        aria-expanded={suggestions.length > 0 ? open : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          openSuggestions()
        }}
        onFocus={openSuggestions}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            setOpen(false)
            setActiveModelId(null)
          } else if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setOpen(true)
            const nextIndex = activeIndex < 0
              ? event.key === 'ArrowUp' ? suggestions.length - 1 : 0
              : (activeIndex + (event.key === 'ArrowUp' ? -1 : 1) + suggestions.length) % suggestions.length
            setActiveModelId(suggestions[nextIndex]?.id ?? null)
          } else if (event.key === 'Enter' && open && activeModel) {
            event.preventDefault()
            chooseSuggestion(activeModel)
          }
        }}
        placeholder={placeholder ?? 'model id'}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {suggestions.length > 0 && (
        <button
          type="button"
          aria-label={suggestionsLabel ?? 'Show model suggestions'}
          aria-controls={listId}
          aria-expanded={open}
          onClick={() => {
            if (open) {
              setOpen(false)
              setActiveModelId(null)
            } else {
              openSuggestions()
              inputRef.current?.focus()
            }
          }}
          className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {open && suggestions.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={suggestionsLabel ?? 'Model suggestions'}
          className="oa-popover-enter absolute left-0 right-0 top-full z-40 mt-1 max-h-52 overflow-y-auto rounded-lg border border-border/70 bg-secondary p-1 shadow-lg"
        >
          {suggestions.map((model, index) => (
            <button
              key={model.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={model.id === value}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveModelId(model.id)}
              onClick={() => chooseSuggestion(model)}
              className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                index === activeIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              <ModelIdentity model={model.id} label={model.label} vendor={vendor} className="flex-1" />
              {model.id === value && <span aria-hidden className="mt-0.5 text-xs text-primary">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
