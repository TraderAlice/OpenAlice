import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { useAutoSave } from '../hooks/useAutoSave'

const inputClass =
  'w-full px-2.5 py-2 bg-bg text-text border border-border rounded-md font-sans text-sm outline-none transition-colors focus:border-accent'

interface SecuritiesConfig {
  allowedSymbols: string[]
  provider: {
    type: 'alpaca' | 'none'
    paper?: boolean
  }
  guards: Array<{ type: string; options: Record<string, unknown> }>
}

export function SecuritiesPage() {
  const [config, setConfig] = useState<SecuritiesConfig | null>(null)
  const [loadError, setLoadError] = useState(false)
  const flushRequestedRef = useRef(false)

  useEffect(() => {
    api.config
      .load()
      .then((full) => setConfig((full as Record<string, unknown>).securities as SecuritiesConfig))
      .catch(() => setLoadError(true))
  }, [])

  const saveSecurities = useCallback(async (data: SecuritiesConfig) => {
    const result = await api.config.updateSection('securities', data)
    setConfig(result as SecuritiesConfig)
  }, [])

  const { status, flush, retry } = useAutoSave({
    data: config!,
    save: saveSecurities,
    delay: 600,
    enabled: config !== null,
  })

  useEffect(() => {
    if (flushRequestedRef.current && config) {
      flushRequestedRef.current = false
      flush()
    }
  }, [config, flush])

  const updateConfig = useCallback((patch: Partial<SecuritiesConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const updateConfigImmediate = useCallback((patch: Partial<SecuritiesConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
    flushRequestedRef.current = true
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Securities Trading</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Alpaca broker connection and trading guard configuration for US equities.
            </p>
          </div>
          <SaveIndicator status={status} onRetry={retry} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            <ProviderSection
              config={config}
              onChangeImmediate={updateConfigImmediate}
            />
            <GuardsSection
              config={config}
              onChange={updateConfig}
              onChangeImmediate={updateConfigImmediate}
            />
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">Failed to load configuration.</p>}
      </div>
    </div>
  )
}

// ==================== Shared ====================

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">
        {title}
      </h3>
      {description && <p className="text-[12px] text-text-muted mt-1">{description}</p>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-[13px] text-text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

// ==================== Provider Section ====================

function ProviderSection({
  config,
  onChangeImmediate,
}: {
  config: SecuritiesConfig
  onChangeImmediate: (patch: Partial<SecuritiesConfig>) => void
}) {
  const isAlpaca = config.provider.type === 'alpaca'

  return (
    <div>
      <SectionHeader
        title="Broker"
        description="Alpaca brokerage connection. API keys are read from ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables."
      />
      <label className="flex items-center gap-2.5 cursor-pointer mb-2">
        <Toggle
          checked={isAlpaca ? config.provider.paper ?? true : true}
          onChange={(v) =>
            onChangeImmediate({
              provider: { ...config.provider, type: 'alpaca', paper: v },
            })
          }
        />
        <span className="text-[13px] text-text">Paper Trading</span>
      </label>
      <p className="text-[11px] text-text-muted/60">
        When enabled, orders are routed to Alpaca's paper trading environment. Disable for live trading.
      </p>
    </div>
  )
}

// ==================== Guards Section ====================

const GUARD_TYPES = [
  {
    type: 'max-position-size',
    label: 'Max Position Size',
    desc: 'Limits each position as a percentage of account equity.',
  },
  {
    type: 'cooldown',
    label: 'Cooldown',
    desc: 'Enforces a minimum interval between trades on the same symbol.',
  },
] as const

type GuardEntry = { type: string; options: Record<string, unknown> }

function guardSummary(g: GuardEntry): string {
  switch (g.type) {
    case 'max-position-size': {
      const pct = Number(g.options.maxPercentOfEquity ?? 25)
      return `${pct}% of equity`
    }
    case 'cooldown': {
      const ms = Number(g.options.minIntervalMs ?? 60000)
      return `${Math.round(ms / 1000)}s`
    }
    default:
      return g.type
  }
}

interface SectionProps {
  config: SecuritiesConfig
  onChange: (patch: Partial<SecuritiesConfig>) => void
  onChangeImmediate: (patch: Partial<SecuritiesConfig>) => void
}

function GuardsSection({ config, onChange, onChangeImmediate }: SectionProps) {
  const guards = config.guards || []
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const addGuard = (type: string) => {
    const defaults: Record<string, Record<string, unknown>> = {
      'max-position-size': { maxPercentOfEquity: 25 },
      cooldown: { minIntervalMs: 60000 },
    }
    const newGuards = [...guards, { type, options: defaults[type] || {} }]
    onChangeImmediate({ guards: newGuards })
    setEditingIdx(newGuards.length - 1)
  }

  const removeGuard = (idx: number) => {
    onChangeImmediate({ guards: guards.filter((_, i) => i !== idx) })
    setEditingIdx(null)
  }

  const moveGuard = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= guards.length) return
    const next = [...guards]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChangeImmediate({ guards: next })
    setEditingIdx((prev) => (prev === idx ? target : prev))
  }

  const updateOptions = (idx: number, options: Record<string, unknown>) => {
    const next = guards.map((g, i) => (i === idx ? { ...g, options } : g))
    onChange({ guards: next })
  }

  const availableTypes = GUARD_TYPES.filter((t) => !guards.some((g) => g.type === t.type))

  return (
    <div className="border-t border-border pt-5">
      <SectionHeader
        title="Guards"
        description="Trading guards validate operations before they reach the broker. Guards run in order — first rejection stops the operation."
      />

      {guards.length === 0 && (
        <p className="text-[12px] text-text-muted/60 mb-3">
          No guards configured. All trades will pass through unchecked.
        </p>
      )}

      <div className="space-y-2 mb-3">
        {guards.map((guard, idx) => {
          const meta = GUARD_TYPES.find((t) => t.type === guard.type)
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
    </div>
  )
}

function AddGuardButton({
  types,
  onAdd,
}: {
  types: ReadonlyArray<{ type: string; label: string; desc: string }>
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
          onClick={() => {
            onAdd(type)
            setOpen(false)
          }}
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
    case 'cooldown':
      return <CooldownEditor options={options} onChange={onChange} />
    default:
      return <GenericEditor options={options} onChange={onChange} />
  }
}

function MaxPositionSizeEditor({
  options,
  onChange,
}: {
  options: Record<string, unknown>
  onChange: (opts: Record<string, unknown>) => void
}) {
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

function CooldownEditor({
  options,
  onChange,
}: {
  options: Record<string, unknown>
  onChange: (opts: Record<string, unknown>) => void
}) {
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

function GenericEditor({
  options,
  onChange,
}: {
  options: Record<string, unknown>
  onChange: (opts: Record<string, unknown>) => void
}) {
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
