/**
 * Reusable preset-enumeration form controls, shared by the AI Provider
 * credential vault and the per-workspace AI config modal.
 *
 * - ModelCombobox: an editable input with an explicit suggestion popover. The
 *   suggestions curb typos (minimax-m3 vs MiniMax-M3) for known vendors while
 *   still allowing a free-typed model id (no version-lock) — and for custom /
 *   unrecognized providers it's just a plain input.
 */

import { useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputClass } from '../form'
import type { LabeledOption } from '../../lib/presetHelpers'

export function ModelCombobox({
  value,
  suggestions,
  onChange,
  placeholder,
  ariaLabel,
  suggestionsLabel,
}: {
  value: string
  suggestions: LabeledOption[]
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  suggestionsLabel?: string
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const openSuggestions = () => {
    if (suggestions.length === 0) return
    setOpen(true)
    setActiveIndex(0)
  }

  const chooseSuggestion = (model: LabeledOption) => {
    onChange(model.id)
    setOpen(false)
    setActiveIndex(-1)
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (!next || !event.currentTarget.contains(next)) {
          setOpen(false)
          setActiveIndex(-1)
        }
      }}
    >
      <input
        ref={inputRef}
        className={`${inputClass}${suggestions.length > 0 ? ' pr-9' : ''}`}
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
          if (suggestions.length === 0) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            setActiveIndex((current) => {
              if (current < 0) return event.key === 'ArrowUp' ? suggestions.length - 1 : 0
              return event.key === 'ArrowUp'
                ? (current - 1 + suggestions.length) % suggestions.length
                : (current + 1) % suggestions.length
            })
          } else if (event.key === 'Enter' && open && activeIndex >= 0) {
            event.preventDefault()
            chooseSuggestion(suggestions[activeIndex]!)
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            setOpen(false)
            setActiveIndex(-1)
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
              setActiveIndex(-1)
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
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseSuggestion(model)}
              className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                index === activeIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-foreground">{model.id}</span>
                {model.label !== model.id && (
                  <span className="mt-0.5 block truncate text-[10.5px]">{model.label}</span>
                )}
              </span>
              {model.id === value && <span aria-hidden className="mt-0.5 text-xs text-primary">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
