import { useState } from 'react'
import { Section, Field, inputClass } from './form'

// ==================== Types ====================

export interface GuardType {
  type: string
  label: string
  desc: string
}

export interface GuardEntry {
  type: string
  options: Record<string, unknown>
}

// ==================== Presets ====================

/** Crypto guards (superset — includes max-leverage) */
export const CRYPTO_GUARD_TYPES: GuardType[] = [
  { type: 'max-position-size', label: 'Max Position Size', desc: 'Limits each position as a percentage of account equity.' },
  { type: 'max-leverage', label: 'Max Leverage', desc: 'Caps leverage for all symbols, with optional per-symbol overrides.' },
  { type: 'cooldown', label: 'Cooldown', desc: 'Enforces a minimum interval between trades on the same symbol.' },
  { type: 'symbol-whitelist', label: 'Symbol Whitelist', desc: 'Restricts trading to a specific set of symbols.' },
]

/** Securities guards (no max-leverage) */
export const SECURITIES_GUARD_TYPES: GuardType[] = [
  { type: 'max-position-size', label: 'Max Position Size', desc: 'Limits each position as a percentage of account equity.' },
  { type: 'cooldown', label: 'Cooldown', desc: 'Enforces a minimum interval between trades on the same symbol.' },
  { type: 'symbol-whitelist', label: 'Symbol Whitelist', desc: 'Restricts trading to a specific set of symbols.' },
]

const GUARD_DEFAULTS: Record<string, Record<string, unknown>> = {
  'max-position-size': { maxPercentOfEquity: 25 },
  'max-leverage': { maxLeverage: 10 },
  cooldown: { minIntervalMs: 60000 },
  'symbol-whitelist': { symbols: [] },
}

// ==================== Summary ====================

export function guardSummary(g: GuardEntry): string {
  switch (g.type) {
    case 'max-position-size': {
      const pct = Number(g.options.maxPercentOfEquity ?? 25)
      return `${pct}% of equity`
    }
    case 'max-leverage': {
      const lev = Number(g.options.maxLeverage ?? 10)
      return `${lev}x max`
    }
    case 'cooldown': {
      const ms = Number(g.options.minIntervalMs ?? 60000)
      return `${Math.round(ms / 1000)}s`
    }
    case 'symbol-whitelist': {
      const symbols = (g.options.symbols as string[] | undefined) ?? []
      return symbols.length === 0 ? 'none' : `${symbols.length} symbols`
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

export function GuardsSection({ guards, guardTypes, description, onChange, onChangeImmediate }: GuardsSectionProps) {
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
    onChange(guards.map((g, i) => (i === idx ? { ...g, options } : g)))
  }

  const availableTypes = guardTypes.filter((t) => !guards.some((g) => g.type === t.type))

  return (
    <div className="border-t border-border pt-5">
      <Section
        title="Guards"
        description={description}
      >
        {guards.length === 0 && (
          <p className="text-[12px] text-text-muted/60 mb-3">
            No guards configured. All trades will pass through unchecked.
          </p>
        )}

        <div className="space-y-2 mb-3">
          {guards.map((guard, idx) => {
            const meta = guardTypes.find((t) => t.type === guard.type)
            const isEditing = editingIdx === idx
            return (
              <div key={idx} className="border border-border rounded-lg bg-bg-secondary">
                {/* Header row */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    onClick={() => setEditingIdx(isEditing ? null : idx)}
                    className="text-[10px] text-text-muted w-4"
                  >
                    {isEditing ? '▼' : '▶'}
                  </button>
                  <span className="text-[13px] font-medium text-text flex-1">
                    {meta?.label || guard.type}
                    <span className="text-text-muted font-normal ml-2 text-[12px]">
                      {guardSummary(guard)}
                    </span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => moveGuard(idx, -1)}
                      disabled={idx === 0}
                      className="text-text-muted hover:text-text disabled:opacity-25 p-1 text-[11px]"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveGuard(idx, 1)}
                      disabled={idx === guards.length - 1}
                      className="text-text-muted hover:text-text disabled:opacity-25 p-1 text-[11px]"
                      title="Move down"
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => removeGuard(idx)}
                      className="text-text-muted hover:text-red p-1 ml-1 text-[13px]"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Editor */}
                {isEditing && (
                  <div className="px-3 pb-3 pt-1 border-t border-border">
                    {meta && <p className="text-[11px] text-text-muted/60 mb-2">{meta.desc}</p>}
                    <GuardOptionsEditor
                      type={guard.type}
                      options={guard.options}
                      onChange={(opts) => updateOptions(idx, opts)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add guard */}
        {availableTypes.length > 0 && (
          <div className="mb-3">
            <AddGuardButton types={availableTypes} onAdd={addGuard} />
          </div>
        )}
      </Section>
    </div>
  )
}

// ==================== Add Guard Button ====================

function AddGuardButton({
  types,
  onAdd,
}: {
  types: GuardType[]
  onAdd: (type: string) => void
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border border-dashed border-border rounded-lg px-3 py-2 text-[12px] text-text-muted hover:text-text hover:border-text-muted transition-colors w-full text-left"
      >
        + Add Guard
      </button>
    )
  }

  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-3 space-y-1.5">
      <p className="text-[11px] text-text-muted mb-1.5">Select a guard type:</p>
      {types.map(({ type, label, desc }) => (
        <button
          key={type}
          onClick={() => { onAdd(type); setOpen(false) }}
          className="block w-full text-left px-2.5 py-2 rounded-md hover:bg-bg-tertiary transition-colors"
        >
          <span className="text-[13px] text-text font-medium">{label}</span>
          <span className="block text-[11px] text-text-muted/60">{desc}</span>
        </button>
      ))}
      <button onClick={() => setOpen(false)} className="text-[11px] text-text-muted hover:text-text mt-1">
        Cancel
      </button>
    </div>
  )
}

// ==================== Guard Option Editors ====================

function GuardOptionsEditor({
  type,
  options,
  onChange,
}: {
  type: string
  options: Record<string, unknown>
  onChange: (opts: Record<string, unknown>) => void
}) {
  switch (type) {
    case 'max-position-size':
      return <MaxPositionSizeEditor options={options} onChange={onChange} />
    case 'max-leverage':
      return <MaxLeverageEditor options={options} onChange={onChange} />
    case 'cooldown':
      return <CooldownEditor options={options} onChange={onChange} />
    case 'symbol-whitelist':
      return <SymbolWhitelistEditor options={options} onChange={onChange} />
    default:
      return <GenericEditor options={options} onChange={onChange} />
  }
}

interface EditorProps {
  options: Record<string, unknown>
  onChange: (opts: Record<string, unknown>) => void
}

function MaxPositionSizeEditor({ options, onChange }: EditorProps) {
  const pct = Number(options.maxPercentOfEquity ?? 25)
  return (
    <Field label="Max % of Equity per Position">
      <input
        className={inputClass}
        type="number"
        min={1}
        max={100}
        value={pct}
        onChange={(e) => onChange({ ...options, maxPercentOfEquity: Number(e.target.value) })}
      />
      <p className="text-[10px] text-text-muted/60 mt-1">
        Rejects orders where estimated position value exceeds this % of account equity.
      </p>
    </Field>
  )
}

function MaxLeverageEditor({ options, onChange }: EditorProps) {
  const lev = Number(options.maxLeverage ?? 10)
  return (
    <Field label="Maximum Leverage">
      <input
        className={inputClass}
        type="number"
        min={1}
        max={125}
        value={lev}
        onChange={(e) => onChange({ ...options, maxLeverage: Number(e.target.value) })}
      />
      <p className="text-[10px] text-text-muted/60 mt-1">
        Rejects orders and leverage adjustments exceeding this limit.
      </p>
    </Field>
  )
}

function CooldownEditor({ options, onChange }: EditorProps) {
  const ms = Number(options.minIntervalMs ?? 60000)
  const seconds = Math.round(ms / 1000)
  return (
    <Field label="Cooldown (seconds)">
      <input
        className={inputClass}
        type="number"
        min={1}
        value={seconds}
        onChange={(e) => onChange({ ...options, minIntervalMs: Number(e.target.value) * 1000 })}
      />
      <p className="text-[10px] text-text-muted/60 mt-1">
        Minimum seconds between trades on the same symbol.
      </p>
    </Field>
  )
}

function SymbolWhitelistEditor({ options, onChange }: EditorProps) {
  const symbols = (options.symbols as string[] | undefined) ?? []
  const value = symbols.join(', ')
  return (
    <Field label="Allowed Symbols">
      <input
        className={inputClass}
        type="text"
        placeholder="BTC/USD, ETH/USD, SOL/USD"
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          const parsed = raw.split(',').map((s) => s.trim()).filter(Boolean)
          onChange({ ...options, symbols: parsed })
        }}
      />
      <p className="text-[10px] text-text-muted/60 mt-1">
        Comma-separated list of symbols allowed for trading.
      </p>
    </Field>
  )
}

function GenericEditor({ options, onChange }: EditorProps) {
  const [raw, setRaw] = useState(() => JSON.stringify(options, null, 2))
  const [parseError, setParseError] = useState(false)

  const handleBlur = () => {
    try {
      const parsed = JSON.parse(raw)
      setParseError(false)
      onChange(parsed)
    } catch {
      setParseError(true)
    }
  }

  return (
    <Field label="Options (JSON)">
      <textarea
        className={`${inputClass} min-h-[80px] font-mono text-[12px] ${parseError ? 'border-red' : ''}`}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={handleBlur}
      />
      {parseError && <p className="text-[10px] text-red mt-1">Invalid JSON</p>}
    </Field>
  )
}
