import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SettingsScrollArea, inputClass } from '../components/form'
import { Skeleton } from '../components/StateViews'
import { Toggle } from '../components/Toggle'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { PageHeader } from '../components/PageHeader'
import { HealthBadge } from '../components/uta/HealthBadge'
import { CreateUTADialog } from '../components/uta/CreateUTADialog'
import { EditUTADialog } from '../components/uta/EditUTADialog'
import { fmt } from '../lib/format'
import { api } from '../api'
import type { TradingServiceStatus } from '../api/trading'
import { useWorkspace } from '../tabs/store'
import type { UTAConfig, BrokerPreset, BrokerHealthInfo, BrokerPackStatus } from '../api/types'

// ==================== External order monitoring cadence ====================
//
// data/config/trading.json observeExternalOrdersEvery — how often UTA lists
// the broker's open orders to catch ones placed outside Alice. Saving
// bounces the UTA process (boot-time config), same protocol as broker
// edits; the health badges show the brief reconnect.

const OBSERVE_CADENCE_OPTIONS = ['off', '1m', '5m', '10m', '15m'] as const
const KEYLESS_DATA_SOURCE_OPTIONS = [
  { id: 'binance', label: 'Binance' },
  { id: 'okx', label: 'OKX' },
  { id: 'bybit', label: 'Bybit' },
] as const

type KeylessDataSource = typeof KEYLESS_DATA_SOURCE_OPTIONS[number]['id']

interface TradingRuntimeConfig {
  observeExternalOrdersEvery: string
  keylessDataSources: KeylessDataSource[]
  mode?: 'lite' | 'readonly' | 'pro'
}

async function loadTradingRuntimeConfig(): Promise<TradingRuntimeConfig> {
  const cfg = await fetch('/api/config').then((r) => r.json())
  return {
    observeExternalOrdersEvery: cfg?.trading?.observeExternalOrdersEvery ?? '15m',
    mode: cfg?.trading?.mode,
    keylessDataSources: Array.isArray(cfg?.trading?.keylessDataSources)
      ? cfg.trading.keylessDataSources.filter((v: unknown): v is KeylessDataSource =>
        KEYLESS_DATA_SOURCE_OPTIONS.some((o) => o.id === v))
      : [],
  }
}

async function writeTradingRuntimeConfig(next: TradingRuntimeConfig): Promise<void> {
  const res = await fetch('/api/config/trading', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

async function saveTradingRuntimeConfigPatch(patch: Partial<TradingRuntimeConfig>): Promise<TradingRuntimeConfig> {
  const current = await loadTradingRuntimeConfig()
  const next = { ...current, ...patch }
  await writeTradingRuntimeConfig(next)
  return next
}

function ExternalOrderMonitoringRow() {
  const [value, setValue] = useState<string | null>(null)
  const [runtimeConfig, setRuntimeConfig] = useState<TradingRuntimeConfig | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    loadTradingRuntimeConfig()
      .then((cfg) => {
        if (!cancelled) {
          setRuntimeConfig(cfg)
          setValue(cfg.observeExternalOrdersEvery)
        }
      })
      .catch(() => { if (!cancelled) setValue('15m') })
    return () => { cancelled = true }
  }, [])

  const save = async (next: string) => {
    const prev = value
    const current = runtimeConfig ?? { observeExternalOrdersEvery: prev ?? '15m', keylessDataSources: [] }
    const updated = { ...current, observeExternalOrdersEvery: next }
    setValue(next)
    setRuntimeConfig(updated)
    setMsg('')
    try {
      const saved = await saveTradingRuntimeConfigPatch({ observeExternalOrdersEvery: next })
      setRuntimeConfig(saved)
      setMsg('Saved — restarting UTA to apply')
      setTimeout(() => setMsg(''), 4000)
    } catch (err) {
      setValue(prev)
      setRuntimeConfig(current)
      setMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (value === null) return null

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border border-border rounded-lg">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-foreground">External order monitoring</div>
        <div className="text-[11px] text-muted-foreground">
          How often to scan for orders placed outside Alice (exchange app, direct API).
          Known pending orders are tracked every 10s regardless.
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
        <select
          value={value}
          onChange={(e) => { void save(e.target.value) }}
          className={inputClass + ' w-auto'}
        >
          {OBSERVE_CADENCE_OPTIONS.map((v) => (
            <option key={v} value={v}>{v === 'off' ? 'Off' : `Every ${v}`}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function KeylessDataSourcesRow({ ccxtPack, onPackInstalled }: {
  ccxtPack?: BrokerPackStatus
  onPackInstalled: (status: BrokerPackStatus) => void
}) {
  const [runtimeConfig, setRuntimeConfig] = useState<TradingRuntimeConfig | null>(null)
  const [msg, setMsg] = useState('')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadTradingRuntimeConfig()
      .then((cfg) => { if (!cancelled) setRuntimeConfig(cfg) })
      .catch(() => { if (!cancelled) setRuntimeConfig({ observeExternalOrdersEvery: '15m', keylessDataSources: [] }) })
    return () => { cancelled = true }
  }, [])

  const toggle = async (source: KeylessDataSource, enabled: boolean) => {
    if (!runtimeConfig) return
    if (enabled && !ccxtPack?.installed) {
      setMsg('Install crypto data support first')
      return
    }
    const prev = runtimeConfig
    const nextSources = enabled
      ? [...new Set([...prev.keylessDataSources, source])]
      : prev.keylessDataSources.filter((s) => s !== source)
    const next = { ...prev, keylessDataSources: nextSources }
    setRuntimeConfig(next)
    setMsg('')
    try {
      const saved = await saveTradingRuntimeConfigPatch({ keylessDataSources: nextSources })
      setRuntimeConfig(saved)
      setMsg('Saved — restarting UTA to apply')
      setTimeout(() => setMsg(''), 4000)
    } catch (err) {
      setRuntimeConfig(prev)
      setMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const install = async () => {
    setInstalling(true)
    setMsg('Installing crypto data support…')
    try {
      const installed = await api.trading.installBrokerPack('ccxt')
      onPackInstalled(installed)
      setMsg('Installed — choose the feeds you want')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Install failed')
    } finally {
      setInstalling(false)
    }
  }

  if (!runtimeConfig) return null

  return (
    <div className="px-4 py-3 border border-border rounded-lg">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">Public crypto data sources</div>
          <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
            Optional keyless K-line feeds. Disabled by default; enabled sources appear as read-only broker-style bar IDs.
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
          {ccxtPack && !ccxtPack.installed && (
            <button className="btn-secondary" disabled={installing} onClick={() => { void install() }}>
              {installing ? 'Installing…' : ccxtPack.source === 'broken' ? 'Repair data support' : 'Install data support'}
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2">
        {KEYLESS_DATA_SOURCE_OPTIONS.map((source) => {
          const checked = runtimeConfig.keylessDataSources.includes(source.id)
          return (
            <div key={source.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
              <span className="text-[12px] text-foreground">{source.label}</span>
              <Toggle
                size="sm"
                checked={checked}
                disabled={!checked && ccxtPack?.installed !== true}
                ariaLabel={`${source.label} public data source`}
                onChange={(v) => { void toggle(source.id, v) }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ==================== Live equity (across all UTAs) ====================
//
// TradingPage is the CRUD surface for broker connections. The single
// per-card equity number is here as a liveness signal — "this connection
// returned real account data" — not as a portfolio view. Aggregate
// equity, sparklines, 24h deltas, and trade logs live in Portfolio.

interface EquitySummary {
  totalEquity: string
  totalCash: string
  totalUnrealizedPnL: string
  totalRealizedPnL: string
  accounts: Array<{ id: string; label: string; equity: string; cash: string }>
}

export function MissingBrokerPacksNotice({ packs, onInstalled }: {
  packs: BrokerPackStatus[]
  onInstalled: (status: BrokerPackStatus) => void
}) {
  const missing = packs.filter((pack) => !pack.installed && pack.requiredBy.length > 0)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (missing.length === 0) return null

  const install = async (pack: BrokerPackStatus) => {
    if (pack.engine === 'mock') return
    setInstalling(pack.engine)
    setError('')
    try {
      onInstalled(await api.trading.installBrokerPack(pack.engine))
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to install ${pack.engine} support`)
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-foreground">Optional broker support is missing</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            OpenAlice itself can keep running. Install only the integrations used by these accounts or K-line sources.
          </p>
          <div className="mt-3 space-y-2">
            {missing.map((pack) => (
              <div key={pack.engine} className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium uppercase text-foreground">{pack.engine}</div>
                  <div className="truncate text-[11px] text-muted-foreground">Required by {pack.requiredBy.join(', ')}</div>
                  {pack.reason && <div className="mt-0.5 text-[11px] text-warning">{pack.reason}</div>}
                </div>
                <button
                  className="btn-secondary shrink-0"
                  disabled={installing !== null}
                  onClick={() => { void install(pack) }}
                >
                  {installing === pack.engine ? 'Installing…' : pack.source === 'broken' ? 'Repair' : 'Install'}
                </button>
              </div>
            ))}
          </div>
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ==================== Page ====================

export function TradingPage() {
  const tc = useTradingConfig()
  const healthMap = useAccountHealth()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [presets, setPresets] = useState<BrokerPreset[]>([])
  const [equity, setEquity] = useState<EquitySummary | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [serviceStatus, setServiceStatus] = useState<TradingServiceStatus | null>(null)
  const [brokerPacks, setBrokerPacks] = useState<BrokerPackStatus[]>([])

  const updateBrokerPack = (status: BrokerPackStatus) => {
    setBrokerPacks((rows) => [...rows.filter((row) => row.engine !== status.engine), status])
  }

  useEffect(() => {
    api.trading.getBrokerPresets().then(r => setPresets(r.presets)).catch(() => {})
    api.trading.getBrokerPacks().then(r => setBrokerPacks(r.packs)).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const status = await api.trading.status()
        if (!cancelled) setServiceStatus(status)
      } catch {
        if (!cancelled) setServiceStatus({
          available: false,
          state: 'unavailable',
          mode: 'lite',
          modeSource: 'auto',
          envLocked: false,
          hasUTAConfig: false,
          reason: 'status_unreachable',
          hint: 'Trading service status is not reachable. Alice is running in lite mode.',
        })
      }
    }
    void refresh()
    const id = setInterval(refresh, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Per-card liveness signal — `equity()` lets each card show "this
  // connection actually returned an account balance" rather than just
  // "ping went through". 60s cadence is enough; trend/sparkline/aggregate
  // moved to Portfolio.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const eq = await api.trading.equity().catch(() => null)
      if (cancelled) return
      if (eq) {
        setEquity(eq)
        setLastUpdated(new Date())
      }
    }
    refresh()
    const id = setInterval(refresh, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const editingUTA = editingId ? tc.utas.find(u => u.id === editingId) : null
  const editingPreset = editingUTA ? presets.find(p => p.id === editingUTA.presetId) : undefined

  const openInPortfolio = (id: string) => {
    setEditingId(null)
    setSidebar('portfolio')
    openOrFocus({ kind: 'uta-detail', params: { id } })
  }

  if (tc.loading) return (
    <PageShell subtitle="Configure your UTAs (Unified Trading Accounts).">
      <div className="max-w-[820px] mx-auto space-y-2.5" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5 rounded-lg border border-border bg-secondary">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-2.5 w-20" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </PageShell>
  )
  if (tc.error) {
    return (
      <PageShell subtitle="Failed to load trading configuration.">
        <p className="text-[13px] text-destructive">{tc.error}</p>
        <button onClick={tc.refresh} className="mt-2 btn-secondary">Retry</button>
      </PageShell>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Trading"
        description="Configure your UTAs (Unified Trading Accounts)."
        live={tc.utas.length > 0 ? { lastUpdated } : undefined}
      />

      <SettingsScrollArea className="px-4 py-5 md:px-6">
        <div className="max-w-[820px] mx-auto space-y-4">
          {serviceStatus?.available === false && <TradingServiceOfflineBanner status={serviceStatus} />}
          <MissingBrokerPacksNotice packs={brokerPacks} onInstalled={updateBrokerPack} />
          {tc.utas.length === 0 ? (
            <EmptyState onAdd={() => setShowAdd(true)} />
          ) : (
            <div className="space-y-2.5">
              {tc.utas.map((uta) => {
                const equityRow = equity?.accounts.find(a => a.id === uta.id) ?? null
                return (
                  <UTACard
                    key={uta.id}
                    uta={uta}
                    preset={presets.find(p => p.id === uta.presetId)}
                    health={healthMap[uta.id]}
                    equity={equityRow}
                    onClick={() => setEditingId(uta.id)}
                  />
                )
              })}
              <button
                onClick={() => setShowAdd(true)}
                className="w-full py-2.5 text-[12px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-muted-foreground/40 rounded-lg transition-colors"
              >
                + Add UTA
              </button>
            </div>
          )}

          <KeylessDataSourcesRow
            ccxtPack={brokerPacks.find((row) => row.engine === 'ccxt')}
            onPackInstalled={updateBrokerPack}
          />
          {tc.utas.length > 0 && <ExternalOrderMonitoringRow />}
        </div>
      </SettingsScrollArea>

      {showAdd && (
        <CreateUTADialog
          presets={presets}
          onSave={async (uta) => {
            const created = await tc.createUTA(uta)
            // Persisted — close NOW. The first broker connection runs in the
            // background and the list's health badge tracks it (Reconnecting
            // → Connected/Offline); credential validity has its own explicit
            // Test step in the wizard. Holding the dialog open on a failed
            // first connect lies about an already-created UTA — re-clicking
            // Save can only 409.
            setShowAdd(false)
            void tc.reconnectUTA(created.id).catch(() => {})
            // Trigger a fresh fetch so the new UTA shows live numbers right away.
            void api.trading.equity().then(setEquity).catch(() => {})
            return created
          }}
          onOpenExisting={(id) => {
            setShowAdd(false)
            setEditingId(id)
          }}
          onClose={() => setShowAdd(false)}
          onPackInstalled={updateBrokerPack}
        />
      )}

      {editingUTA && (
        <EditUTADialog
          uta={editingUTA}
          preset={editingPreset}
          health={healthMap[editingUTA.id]}
          onSave={async (next) => { await tc.saveUTA(next) }}
          onDelete={async () => {
            await tc.deleteUTA(editingUTA.id)
            setEditingId(null)
          }}
          onViewInPortfolio={() => openInPortfolio(editingUTA.id)}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

// ==================== Page Shell ====================

function PageShell({ subtitle, children }: { subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Trading" description={subtitle} />
      <SettingsScrollArea className="px-4 py-5 md:px-6">{children}</SettingsScrollArea>
    </div>
  )
}

function TradingServiceOfflineBanner({ status }: { status: TradingServiceStatus }) {
  return (
    <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3" role="status">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-foreground">Trading service offline</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
          {status.hint ?? 'Alice is running in lite mode.'}
          {status.reason ? <span className="ml-1 font-mono text-muted-foreground/70">{status.reason}</span> : null}
        </div>
      </div>
    </div>
  )
}

// ==================== Empty State ====================

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center sm:p-12">
      <h3 className="text-[16px] font-semibold text-foreground mb-2">No UTAs configured</h3>
      <p className="text-[13px] text-muted-foreground mb-6 max-w-[320px] mx-auto leading-relaxed">
        Connect a crypto exchange or brokerage to start automated trading.
      </p>
      <button onClick={onAdd} className="btn-primary">
        + Add UTA
      </button>
    </div>
  )
}

// ==================== Portfolio banner (hero) ====================

// ==================== Subtitle builder ====================

function buildSubtitle(uta: UTAConfig, preset?: BrokerPreset): string {
  if (!preset) return uta.presetId
  const pc = uta.presetConfig
  const parts: string[] = []
  for (const sf of preset.subtitleFields) {
    const val = pc[sf.field]
    if (typeof val === 'boolean') {
      if (val && sf.label) parts.push(sf.label)
      else if (!val && sf.falseLabel) parts.push(sf.falseLabel)
    } else if (val != null && val !== '') {
      let display = String(val)
      if (sf.field === 'mode' && preset.modes) {
        const mode = preset.modes.find(m => m.id === val)
        if (mode) display = mode.label
      }
      parts.push(`${sf.prefix ?? ''}${display}`)
    }
  }
  return parts.join(' · ') || preset.label
}

// ==================== UTA Card ====================

function UTACard({ uta, preset, health, equity, onClick }: {
  uta: UTAConfig
  preset?: BrokerPreset
  health?: BrokerHealthInfo
  equity?: { equity: string; cash: string } | null
  onClick: () => void
}) {
  const isDisabled = health?.disabled || uta.enabled === false
  const badge = preset
    ? { text: preset.badge, color: `${preset.badgeColor} ${preset.badgeColor.replace('text-', 'bg-')}/10` }
    : { text: uta.presetId.slice(0, 2).toUpperCase(), color: 'text-muted-foreground bg-muted-foreground/10' }

  // Per-card equity is a liveness signal, not a portfolio view —
  // proves the connection returned a real account balance, not just
  // a ping. Aggregate / curves / per-account drill-in all live in
  // Portfolio.
  const equityNum = equity ? Number(equity.equity) : null
  const equityNode = !isDisabled && equityNum != null && Number.isFinite(equityNum)
    ? <span className="tabular-nums">{fmt(equityNum, 'USD')}</span>
    : null

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border border-border bg-secondary/30 px-4 py-3 transition-all hover:border-muted-foreground/40 hover:bg-muted/20 ${isDisabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-bold px-2 py-1 rounded-md shrink-0 ${badge.color}`}>
          {badge.text}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-foreground truncate">{uta.label || uta.id}</div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono">
            {uta.id}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {buildSubtitle(uta, preset)}
            {uta.guards.length > 0 && <span className="ml-1.5 text-muted-foreground/50">{uta.guards.length} guard{uta.guards.length > 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          {equityNode && (
            <span className="text-[11px] text-muted-foreground/80 hidden sm:inline">{equityNode}</span>
          )}
          {uta.enabled === false
            ? <span className="text-[11px] text-muted-foreground">Disabled</span>
            : <HealthBadge health={health} />
          }
        </div>
      </div>
    </button>
  )
}
