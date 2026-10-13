/**
 * InstrumentInput — secType picker + conditional fields (expiry / strike /
 * right / multiplier) for OPT/FOP/FUT. Plain symbol-only flow for the
 * other secTypes. Shared between External Deposit and External Trade tabs.
 *
 * Emits `InstrumentDraft` upward; the parent calls `buildInstrument()`
 * at submit time to derive nativeKey + contract.
 */

import { Autocomplete } from '@/components/ui/autocomplete'
import { Select } from '@/components/ui/select'

import type { InstrumentDraft, SecType } from './instruments'
import { SEC_TYPES } from './instruments'
import { inputClass as sharedInputClass } from '../../components/form'

const inputClassMono =
  `${sharedInputClass} min-h-8 py-1 font-mono text-xs`

export function InstrumentInput({ draft, onChange, knownSymbols }: {
  draft: InstrumentDraft
  onChange: (next: InstrumentDraft) => void
  knownSymbols?: string[]
}) {
  const set = <K extends keyof InstrumentDraft>(field: K, value: InstrumentDraft[K]) =>
    onChange({ ...draft, [field]: value })

  const isOption = draft.secType === 'OPT' || draft.secType === 'FOP'
  const isFuture = draft.secType === 'FUT'

  return (
    <>
      <Select
        value={draft.secType}
        onValueChange={(selectedValue) => set('secType', selectedValue as SecType)}
        className="w-32" aria-label="Security type"
        title="Security type"
        options={SEC_TYPES.map((s) => ({ value: s, label: s }))}
      />

      <Autocomplete
        className="w-28 font-mono"
        aria-label="Symbol"
        placeholder="symbol"
        value={draft.symbol}
        onValueChange={(symbol) => set('symbol', symbol.trim())}
        options={knownSymbols ?? []}
      />

      {(isOption || isFuture) && (
        <input
          className={`${inputClassMono} w-28`}
          placeholder={isOption ? 'expiry YYYYMMDD' : 'expiry YYYYMM'}
          value={draft.expiry ?? ''}
          onChange={(e) => set('expiry', e.target.value.trim())}
        />
      )}

      {isOption && (
        <>
          <input
            className={`${inputClassMono} w-20`}
            placeholder="strike"
            value={draft.strike ?? ''}
            onChange={(e) => set('strike', e.target.value)}
          />
          <Select
            value={draft.right ?? ''}
            onValueChange={(selectedValue) => set('right', (selectedValue || undefined) as 'C' | 'P' | undefined)}
            className="w-24" aria-label="Option right"
            title="Right"
            options={[
              { value: '', label: 'right' },
              { value: 'C', label: 'Call' },
              { value: 'P', label: 'Put' },
            ]}
          />
        </>
      )}

      {(isOption || isFuture) && (
        <input
          className={`${inputClassMono} w-20`}
          placeholder={isOption ? 'mult (100)' : 'mult (1)'}
          value={draft.multiplier ?? ''}
          onChange={(e) => set('multiplier', e.target.value)}
        />
      )}
    </>
  )
}
