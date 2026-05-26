import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Field, inputClass } from './form'

// ==================== Types ====================

export interface GuardType {
  type: string
}

export interface GuardEntry {
  type: string
  options: Record<string, unknown>
}

// ==================== Presets ====================

/** Crypto guards (superset — includes max-leverage) */
export const CRYPTO_GUARD_TYPES: GuardType[] = [
  { type: 'max-position-size' },
  { type: 'max-leverage' },
  { type: 'cooldown' },
  { type: 'symbol-whitelist' },
]

/** Securities guards (no max-leverage) */
export const SECURITIES_GUARD_TYPES: GuardType[] = [
  { type: 'max-position-size' },
  { type: 'cooldown' },
  { type: 'symbol-whitelist' },
]

const GUARD_DEFAULTS: Record<string, Record<string, unknown>> = {
  'max-position-size': { maxPercentOfEquity: 25 },
  'max-leverage': { maxLeverage: 10 },
  cooldown: { minIntervalMs: 60000 },
  'symbol-whitelist': { symbols: [] },
}

// ==================== Summary ====================

export function guardSummary(g: GuardEntry, t: TFunction): string {
  switch (g.type) {
    case 'max-position-size': {
      const pct = Number(g.options.maxPercentOfEquity ?? 25)
      return t('guards.percentOfEquity', '{{pct}}% of equity', { pct })
    }
    case 'max-leverage': {
      const lev = Number(g.options.maxLeverage ?? 10)
      return t('guards.maxLeverageValue', '{{lev}}x max', { lev })
    }
    case 'cooldown': {
      const ms = Number(g.options.minIntervalMs ?? 60000)
      return t('guards.seconds', '{{sec}}s', { sec: Math.round(ms / 1000) })
    }
    case 'symbol-whitelist': {
      const symbols = (g.options.symbols as string[] | undefined) ?? []
      return symbols.length === 0 ? t('guards.noSymbols', 'none') : t('guards.symbolCount', '{{count}} symbols', { count: symbols.length })
    }
    default:
      return g.type
  }
}

// ==================== Guards Section ====================

interface GuardsSectionProps {
  guards: GuardEntry[]
  guardTypes: GuardType[]
  /** Description shown under the "Guards" heading */
  description: string
  onChange: (guards: GuardEntry[]) => void
  onChangeImmediate: (guards: GuardEntry[]) => void
}

export function GuardsSection({ guards, guardTypes, description, onChange: _onChange, onChangeImmediate }: GuardsSectionProps) {
  const { t } = useTranslation()
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const addGuard = (type: string) => {
    const newGuards = [...guards, { type, options: GUARD_DEFAULTS[type] || {} }]
    onChangeImmediate(newGuards)
    setEditingIdx(newGuards.length - 1)
  }

  const removeGuard = (idx: number) => {
    onChangeImmediate(guards.filter((_, i) => i !== idx))
    setEditingIdx(null)
  }

  const moveGuard = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= guards.length) return
    const next = [...guards]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChangeImmediate(next)
    setEditingIdx((prev) => (prev === idx ? target : prev))
  }

  const updateOptions = (idx: number, options: Record<string, unknown>) => {
    const next = guards.map((g, i) => (i === idx ? { ...g, options } : g))
    onChangeImmediate(next)
  }

  const getGuardType = (type: string) => guardTypes.find((g) => g.type === type)!

  const getGuardLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'max-position-size': t('guards.maxPositionSize', 'Max Position Size'),
      'max-leverage': t('guards.maxLeverage', 'Max Leverage'),
      'cooldown': t('guards.cooldown', 'Cooldown'),
      'symbol-whitelist': t('guards.symbolWhitelist', 'Symbol Whitelist'),
    }
    return labels[type] || type
  }

  const getGuardDesc = (type: string): string => {
    const descs: Record<string, string> = {
      'max-position-size': t('guards.maxPositionSizeDesc', 'Limits each position as a percentage of account equity.'),
      'max-leverage': t('guards.maxLeverageDesc', 'Caps leverage for all symbols, with optional per-symbol overrides.'),
      'cooldown': t('guards.cooldownDesc', 'Enforces a minimum interval between trades on the same symbol.'),
      'symbol-whitelist': t('guards.symbolWhitelistDesc', 'Restricts trading to a specific set of symbols.'),
    }
    return descs[type] || ''
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-text-muted">{description}</p>

      {guards.map((g, idx) => {
        const isEditing = editingIdx === idx
        return (
          <div key={idx} className="border border-border rounded-md overflow-hidden">
            {/* Header row */}
            <button
              onClick={() => setEditingIdx(isEditing ? null : idx)}
              className="w-full flex items-center justify-between px-3 py-2 bg-bg-secondary hover:bg-bg-tertiary transition-colors"
            >
              <span className="text-[12px] font-medium text-text">{getGuardLabel(g.type)}</span>
              <span className="text-[11px] text-text-muted">{guardSummary(g, t)}</span>
            </button>

            {/* Expanded editor */}
            {isEditing && (
              <div className="px-3 py-3 space-y-3 bg-bg">
                <p className="text-[11px] text-text-muted">{getGuardDesc(g.type)}</p>

                {g.type === 'max-position-size' && (
                  <Field label={t('guards.maxPercentOfEquity', 'Max % of equity')}>
                    <input
                      className={inputClass}
                      type="number"
                      value={Number(g.options.maxPercentOfEquity ?? 25)}
                      onChange={(e) => updateOptions(idx, { ...g.options, maxPercentOfEquity: Number(e.target.value) })}
                    />
                  </Field>
                )}

                {g.type === 'max-leverage' && (
                  <Field label={t('guards.maxLeverage', 'Max leverage')}>
                    <input
                      className={inputClass}
                      type="number"
                      value={Number(g.options.maxLeverage ?? 10)}
                      onChange={(e) => updateOptions(idx, { ...g.options, maxLeverage: Number(e.target.value) })}
                    />
                  </Field>
                )}

                {g.type === 'cooldown' && (
                  <Field label={t('guards.minIntervalSec', 'Min interval (seconds)')}>
                    <input
                      className={inputClass}
                      type="number"
                      value={Math.round(Number(g.options.minIntervalMs ?? 60000) / 1000)}
                      onChange={(e) => updateOptions(idx, { ...g.options, minIntervalMs: Number(e.target.value) * 1000 })}
                    />
                  </Field>
                )}

                {g.type === 'symbol-whitelist' && (
                  <Field label={t('guards.symbols', 'Symbols (comma-separated)')}>
                    <input
                      className={inputClass}
                      value={(g.options.symbols as string[] | undefined)?.join(', ') ?? ''}
                      onChange={(e) => updateOptions(idx, { ...g.options, symbols: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    />
                  </Field>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => moveGuard(idx, -1)}
                    disabled={idx === 0}
                    className="text-[11px] px-2 py-1 rounded border border-border hover:bg-bg-secondary disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveGuard(idx, 1)}
                    disabled={idx === guards.length - 1}
                    className="text-[11px] px-2 py-1 rounded border border-border hover:bg-bg-secondary disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeGuard(idx)}
                    className="text-[11px] px-2 py-1 rounded text-red border border-red/30 hover:bg-red/10 ml-auto"
                  >
                    {t('common.delete', 'Delete')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Add guard dropdown */}
      <div className="pt-1">
        <select
          className={`${inputClass} text-[12px]`}
          value=""
          onChange={(e) => {
            if (e.target.value) {
              addGuard(e.target.value)
              e.target.value = ''
            }
          }}
        >
          <option value="">{t('guards.addGuard', '+ Add guard')}</option>
          {guardTypes.map((gt) => (
            <option key={gt.type} value={gt.type}>
              {getGuardLabel(gt.type)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
