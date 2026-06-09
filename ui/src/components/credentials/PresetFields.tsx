/**
 * Reusable preset-enumeration form controls, shared by the AI Provider
 * credential vault and the per-workspace AI config modal.
 *
 * - ModelCombobox: an <input> backed by a <datalist> of suggested models. The
 *   suggestions curb typos (minimax-m3 vs MiniMax-M3) for known vendors while
 *   still allowing a free-typed model id (no version-lock) — and for custom /
 *   unrecognized providers it's just a plain input.
 */

import { useId } from 'react'
import { inputClass } from '../form'
import type { LabeledOption } from '../../lib/presetHelpers'

export function ModelCombobox({ value, suggestions, onChange, placeholder }: {
  value: string
  suggestions: LabeledOption[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const listId = useId()
  return (
    <>
      <input
        className={inputClass}
        list={suggestions.length > 0 ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'model id'}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {/* Chromium shows the option value (the model id), which is the
              human-meaningful string here; the label is a hint where supported. */}
          {suggestions.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </datalist>
      )}
    </>
  )
}
