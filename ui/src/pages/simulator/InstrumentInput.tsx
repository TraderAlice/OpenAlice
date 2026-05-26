/**
 * InstrumentInput — secType picker + conditional fields (expiry / strike /
 * right / multiplier) for OPT/FOP/FUT. Plain symbol-only flow for the
 * other secTypes. Shared between External Deposit and External Trade tabs.
 *
 * Emits `InstrumentDraft` upward; the parent calls `buildInstrument()`
 * at submit time to derive nativeKey + contract.
 */

import type { InstrumentDraft, SecType } from './instruments'
import { SEC_TYPES } from './instruments'
import { useTranslation } from 'react-i18next'

const inputClass =
  'px-2 py-1 bg-bg text-text border border-border rounded text-sm outline-none transition-colors focus:border-accent'
const inputClassMono =
  'px-2 py-1 bg-bg text-text border border-border rounded font-mono text-xs outline-none transition-colors focus:border-accent'

export function InstrumentInput({ draft, onChange, knownSymbols }: {
  draft: InstrumentDraft
  onChange: (next: InstrumentDraft) => void
  knownSymbols?: string[]
}) {
  const { t } = useTranslation()
  const set = <K extends keyof InstrumentDraft>(field: K, value: InstrumentDraft[K]) =>
    onChange({ ...draft, [field]: value })

  const isOption = draft.secType === 'OPT' || draft.secType === 'FOP'
  const isFuture = draft.secType === 'FUT'

  return (
    <>
      <select
        value={draft.secType}
        onChange={(e) => set('secType', e.target.value as SecType)}
        className={`${inputClass} w-32`}
        title={t('simulator.securityType', 'Security type')}
      >
        {SEC_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <input
        className={`${inputClassMono} w-28`}
        placeholder="symbol"
        value={draft.symbol}
        onChange={(e) => set('symbol', e.target.value.trim())}
        list={knownSymbols ? 'sim-instrument-known' : undefined}
      />
      {knownSymbols && (
        <datalist id="sim-instrument-known">
          {knownSymbols.map((k) => <option key={k} value={k} />)}
        </datalist>
      )}

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
          <select
            value={draft.right ?? ''}
            onChange={(e) => set('right', (e.target.value || undefined) as 'C' | 'P' | undefined)}
            className={`${inputClass} w-16`}
            title={t('simulator.right', 'Right')}
          >
            <option value="">right</option>
            <option value="C">Call</option>
            <option value="P">Put</option>
          </select>
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
