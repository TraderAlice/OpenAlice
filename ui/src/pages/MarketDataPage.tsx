import { useEffect, useRef, useState } from 'react'
import { api, type AppConfig } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import { PageHeader } from '../components/PageHeader'

type MarketDataConfig = Record<string, unknown>

// ==================== Constants ====================

// Chart vendors — live K-line / quote sources. These are the high-frequency,
// can't-be-mediated data the Data Hub deliberately doesn't carry, so each is a
// direct vendor you switch on. There is NO per-asset-class configuration: a
// vendor that's on joins the searchBars candidate pool, and what it can serve
// is discovered by searching (heuristic), never declared here. yfinance is the
// always-on global default; the rest are user-opted regional vendors
// (marketData.extraVendors). TWSE / Vietnam slot in here as new rows.
interface ChartVendor {
  id: string
  name: string
  desc: string
  alwaysOn?: boolean
}

const CHART_VENDORS: ChartVendor[] = [
  {
    id: 'yfinance',
    name: 'yfinance',
    desc: 'Global default — charts & quotes for every market Yahoo lists (US, CN, HK, TW, VN, EU, JP, KR…). Free, no key.',
    alwaysOn: true,
  },
  {
    id: 'eastmoney',
    name: 'Eastmoney 东方财富',
    desc: 'CN A-shares — 中文搜索 (茅台 → 600519) and 前复权 K-lines yfinance can’t give. Public endpoints, no key. Served from China, so slower than yfinance for users abroad.',
  },
  {
    id: 'twse',
    name: 'TWSE + TPEx 臺灣證交所',
    desc: 'Taiwan listed + OTC (上市/上櫃) — 中文/英文 search over the official company roster, plus official P/E·殖利率·股價淨值比 and company profiles yfinance lacks. No key. K-lines come from Yahoo (2330.TW / 6488.TWO).',
  },
]

// Data-provider keys — LOW-frequency data (boards, economy, fundamentals). The
// Data Hub already mediates all of this, so a key here is just a compatibility
// shim: go direct, or unlock the slice the hub doesn't serve (FMP fundamentals).
// Advanced, edge — not the main event.
interface ProviderEntry {
  key: string
  name: string
  desc: string
  hint: string
}

const KEY_GROUPS: { label: string | null; providers: ProviderEntry[] }[] = [
  {
    label: null,
    providers: [
      { key: 'fmp', name: 'FMP', desc: 'Unlocks per-symbol equity fundamentals, discovery, ETF detail — the one key that adds data the hub does not serve.', hint: 'financialmodelingprep.com' },
    ],
  },
  {
    label: 'Covered by the Data Hub — add a key only if you want direct access.',
    providers: [
      { key: 'fred', name: 'FRED', desc: 'Federal Reserve Economic Data — CPI, GDP, interest rates, macro indicators.', hint: 'Free — fred.stlouisfed.org → My Account → API Keys' },
      { key: 'bls', name: 'BLS', desc: 'Bureau of Labor Statistics — employment, payrolls, wages, CPI.', hint: 'Free — data.bls.gov/registrationEngine/' },
      { key: 'eia', name: 'EIA', desc: 'Energy Information Administration — petroleum status, energy reports.', hint: 'Free — eia.gov/opendata/register.php' },
    ],
  },
  {
    label: 'Long tail',
    providers: [
      { key: 'econdb', name: 'EconDB', desc: 'Global macro indicators, country profiles, shipping data.', hint: 'econdb.com' },
      { key: 'intrinio', name: 'Intrinio', desc: 'Equities, ETFs, fundamentals, news, options snapshots.', hint: 'intrinio.com' },
    ],
  },
]

const ALL_PROVIDERS: ProviderEntry[] = KEY_GROUPS.flatMap((g) => g.providers)

type HubPing = 'checking' | 'ok' | 'down'

// ==================== Source coverage derivation ====================

interface SourceRow {
  name: string
  detail?: string
  source: string
  state: 'ok' | 'off'
  cta?: boolean
}

/** Effective source per data family, derived statically from config +
 *  the hub ping — mirrors the backend's hub-first → local-keys fallback
 *  so what the user reads here matches what the engine actually does. */
function deriveSourceRows(
  hubOn: boolean,
  ping: HubPing,
  keys: Record<string, string>,
  extraVendors: string[],
): SourceRow[] {
  const hubLive = hubOn && ping !== 'down' // optimistic while checking
  const hub = { source: 'Hub', state: 'ok' as const }
  const chartVendors = ['yfinance', ...extraVendors].join(' · ')

  return [
    {
      name: 'Market boards',
      detail: 'valuation · macro · futures · risk · rotation',
      ...(hubLive
        ? hub
        : keys.fmp || keys.fred
          ? { source: 'Your keys', state: 'ok' as const }
          : { source: 'Limited — hub off, no keys', state: 'off' as const }),
    },
    {
      name: 'Economy series',
      detail: 'FRED · EIA · BLS',
      ...(hubLive
        ? hub
        : keys.fred || keys.eia || keys.bls
          ? { source: 'Your keys', state: 'ok' as const }
          : { source: 'Needs keys', state: 'off' as const }),
    },
    {
      name: 'Calendars',
      detail: 'earnings · IPO · dividends',
      ...(hubLive
        ? hub
        : keys.fmp
          ? { source: 'FMP', state: 'ok' as const }
          : { source: 'Needs FMP key', state: 'off' as const }),
    },
    {
      name: 'FX rates',
      ...(hubLive ? hub : { source: 'yfinance', state: 'ok' as const }),
    },
    {
      name: 'Charts & quotes',
      detail: 'K-lines and realtime — vendor / broker, never the hub',
      source: chartVendors,
      state: 'ok',
    },
    {
      name: 'Equity fundamentals',
      detail: 'profile · financials · ratios · discovery',
      ...(keys.fmp
        ? { source: 'FMP', state: 'ok' as const }
        : { source: 'Needs FMP key', state: 'off' as const, cta: true }),
    },
  ]
}

// ==================== Page ====================

export function MarketDataPage() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } = useConfigPage<MarketDataConfig>({
    section: 'marketData',
    extract: (full: AppConfig) => (full as Record<string, unknown>).marketData as MarketDataConfig,
  })

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [highlightFmp, setHighlightFmp] = useState(false)
  const [ping, setPing] = useState<HubPing>('checking')
  const fmpRef = useRef<HTMLDivElement>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const enabled = !config || (config as Record<string, unknown>).enabled !== false
  const hub = (config?.hub ?? { enabled: true, baseUrl: 'https://traderhub.openalice.ai' }) as { enabled: boolean; baseUrl: string }

  // Ping the hub via the backend (server-side fetch — the dot reports
  // Alice's connectivity, which is what the fallback chain actually uses).
  // Debounced so URL edits don't fire a probe per keystroke.
  useEffect(() => {
    if (!hub.enabled) return
    let cancelled = false
    setPing('checking')
    const t = setTimeout(async () => {
      try {
        const s = await api.marketData.hubStatus(hub.baseUrl)
        if (!cancelled) setPing(s.reachable ? 'ok' : 'down')
      } catch {
        if (!cancelled) setPing('down')
      }
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [hub.enabled, hub.baseUrl])

  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  if (!config) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PageHeader title="Market Data" description="Structured financial data — prices, fundamentals, macro indicators." />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-text-muted">Loading...</p>
        </div>
      </div>
    )
  }

  const providerKeys = (config.providerKeys ?? {}) as Record<string, string>
  const extraVendors = (config.extraVendors ?? []) as string[]
  const sourceRows = deriveSourceRows(hub.enabled, ping, providerKeys, extraVendors)

  const handleExtraVendorToggle = (id: string, on: boolean) => {
    const next = on ? [...new Set([...extraVendors, id])] : extraVendors.filter((v) => v !== id)
    updateConfigImmediate({ extraVendors: next })
  }

  const handleKeyChange = (keyName: string, value: string) => {
    const all = (config.providerKeys ?? {}) as Record<string, string>
    const updated = { ...all, [keyName]: value }
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(updated)) {
      if (v) cleaned[k] = v
    }
    updateConfig({ providerKeys: cleaned })
  }

  const jumpToFmp = () => {
    setAdvancedOpen(true)
    setHighlightFmp(true)
    // Defer until the advanced section is in the DOM.
    requestAnimationFrame(() => {
      fmpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightFmp(false), 2400)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Market Data"
        description="Structured financial data — prices, fundamentals, macro indicators."
        right={
          <div className="flex items-center gap-3">
            <SaveIndicator status={status} onRetry={retry} />
            <Toggle size="sm" checked={enabled} onChange={(v) => updateConfigImmediate({ enabled: v })} />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
        <div className={`max-w-[880px] mx-auto ${!enabled ? 'opacity-40 pointer-events-none' : ''}`}>
          <HubCard
            hub={hub}
            ping={ping}
            onToggle={(v) => updateConfigImmediate({ hub: { ...hub, enabled: v } })}
          />

          <SourcesCard rows={sourceRows} onAddFmp={jumpToFmp} />

          <ChartVendorsSection extraVendors={extraVendors} onToggle={handleExtraVendorToggle} />

          <AdvancedSection
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((o) => !o)}
            providerKeys={providerKeys}
            onKeyChange={handleKeyChange}
            hub={hub}
            onHubChange={(next) => updateConfigImmediate({ hub: next })}
            fmpRef={fmpRef}
            highlightFmp={highlightFmp}
          />
        </div>
        {loadError && <p className="text-[13px] text-red mt-4 max-w-[880px] mx-auto">Failed to load configuration.</p>}
      </div>
    </div>
  )
}

// ==================== Data Hub card ====================

function HubCard({
  hub,
  ping,
  onToggle,
}: {
  hub: { enabled: boolean; baseUrl: string }
  ping: HubPing
  onToggle: (v: boolean) => void
}) {
  const host = hub.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')

  return (
    <section className="mb-6 border border-border/60 rounded-xl bg-bg-secondary/50 p-5">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-[14px] font-semibold">Data Hub</h2>
        <Toggle size="sm" checked={hub.enabled} onChange={onToggle} />
      </div>
      {hub.enabled ? (
        <div className="flex items-center gap-2 mb-1.5">
          {ping === 'checking' && <span className="w-2 h-2 rounded-full bg-text-muted/40 animate-pulse shrink-0" />}
          {ping === 'ok' && <span className="w-2 h-2 rounded-full bg-green shrink-0" />}
          {ping === 'down' && <span className="w-2 h-2 rounded-full bg-red shrink-0" />}
          <span className="text-[13px] text-text">
            {ping === 'checking' && 'Checking…'}
            {ping === 'ok' && <>Connected · <span className="font-mono text-[12px]">{host}</span></>}
            {ping === 'down' && 'Unreachable — using local sources'}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-2 h-2 rounded-full border border-text-muted/40 shrink-0" />
          <span className="text-[13px] text-text-muted">Off — boards and series use your own keys and vendors.</span>
        </div>
      )}
      <p className="text-[12px] text-text-muted">
        Low-frequency data is served from the hosted hub — no API keys needed.
        Anonymous reads of public data; your own keys always take precedence.
      </p>
    </section>
  )
}

// ==================== Source coverage card ====================

function SourcesCard({ rows, onAddFmp }: { rows: SourceRow[]; onAddFmp: () => void }) {
  return (
    <section className="mb-6">
      <h2 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-2">Data Sources</h2>
      <div className="border border-border/60 rounded-xl bg-bg-secondary/50 divide-y divide-border/40">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-3 px-4 py-3">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${row.state === 'ok' ? 'bg-green' : 'border border-text-muted/50'}`}
            />
            <div className="flex-1 min-w-0">
              <span className="text-[13px] text-text font-medium">{row.name}</span>
              {row.detail && <span className="text-[12px] text-text-muted/60 ml-2">{row.detail}</span>}
            </div>
            <span className={`text-[12px] ${row.state === 'ok' ? 'text-text-muted' : 'text-text-muted/60'}`}>
              {row.source}
            </span>
            {row.cta && (
              <button
                onClick={onAddFmp}
                className="shrink-0 border border-accent/40 text-accent rounded-md px-2.5 py-1 text-[12px] font-medium cursor-pointer hover:bg-accent/10 transition-colors"
              >
                Add key
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ==================== Chart Vendors (live K-line sources) ====================

function ChartVendorsSection({
  extraVendors,
  onToggle,
}: {
  extraVendors: string[]
  onToggle: (id: string, on: boolean) => void
}) {
  return (
    <section className="mb-6">
      <h2 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-2">Chart Vendors</h2>
      <p className="text-[12px] text-text-muted/70 mb-2.5 max-w-[640px]">
        Live K-line &amp; quote sources — queried per symbol, never via the hub. Switch one on and it
        joins the search pool; what it covers is found by searching, not configured here. yfinance is
        the always-on global default.
      </p>
      <div className="space-y-2.5">
        {CHART_VENDORS.map((v) => {
          const on = v.alwaysOn || extraVendors.includes(v.id)
          return (
            <div key={v.id} className="border border-border/60 rounded-xl bg-bg-secondary/50 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${on ? 'bg-green' : 'border border-text-muted/50'}`} />
                  <span className="text-[13px] font-semibold text-text truncate">{v.name}</span>
                </div>
                {v.alwaysOn ? (
                  <span className="text-[11px] text-text-muted/60 uppercase tracking-wider shrink-0">always on</span>
                ) : (
                  <Toggle size="sm" checked={on} onChange={(val) => onToggle(v.id, val)} />
                )}
              </div>
              <p className="text-[12px] text-text-muted/70 mt-1.5 leading-relaxed">{v.desc}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ==================== Advanced ====================

function AdvancedSection({
  open,
  onToggle,
  providerKeys,
  onKeyChange,
  hub,
  onHubChange,
  fmpRef,
  highlightFmp,
}: {
  open: boolean
  onToggle: () => void
  providerKeys: Record<string, string>
  onKeyChange: (keyName: string, value: string) => void
  hub: { enabled: boolean; baseUrl: string }
  onHubChange: (next: { enabled: boolean; baseUrl: string }) => void
  fmpRef: React.RefObject<HTMLDivElement | null>
  highlightFmp: boolean
}) {
  return (
    <section className="mb-8">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[13px] font-semibold text-text-muted hover:text-text cursor-pointer transition-colors py-1"
      >
        <span className={`inline-block transition-transform text-[10px] ${open ? 'rotate-90' : ''}`}>▶</span>
        Advanced
      </button>

      {open && (
        <div className="mt-2 border border-border/60 rounded-xl bg-bg-secondary/30 px-5">
          <KeyProvidersSection
            providerKeys={providerKeys}
            onKeyChange={onKeyChange}
            fmpRef={fmpRef}
            highlightFmp={highlightFmp}
          />

          <ConfigSection
            title="Data Hub Endpoint"
            description="Self-hosters point this at their own TraderHub instance."
          >
            <input
              type="text"
              value={hub.baseUrl}
              onChange={(e) => onHubChange({ ...hub, baseUrl: e.target.value })}
              placeholder="https://traderhub.openalice.ai"
              className="w-full max-w-[420px] px-2.5 py-1.5 bg-bg text-text border border-border rounded-md text-[12px] font-mono outline-none focus:border-accent"
            />
          </ConfigSection>
        </div>
      )}
    </section>
  )
}

// ==================== Test Button ====================

function TestButton({
  status,
  disabled,
  onClick,
}: {
  status: 'idle' | 'testing' | 'ok' | 'error'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 border rounded-md px-3 py-2 text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${
        status === 'ok'
          ? 'border-green text-green'
          : status === 'error'
            ? 'border-red text-red'
            : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
      }`}
    >
      {status === 'testing' ? '...' : status === 'ok' ? 'OK' : status === 'error' ? 'Fail' : 'Test'}
    </button>
  )
}

// ==================== Data Provider Keys (low-frequency) ====================

function KeyProvidersSection({
  providerKeys,
  onKeyChange,
  fmpRef,
  highlightFmp,
}: {
  providerKeys: Record<string, string>
  onKeyChange: (keyName: string, value: string) => void
  fmpRef: React.RefObject<HTMLDivElement | null>
  highlightFmp: boolean
}) {
  const [localKeys, setLocalKeys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const p of ALL_PROVIDERS) init[p.key] = providerKeys[p.key] || ''
    return init
  })
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({})

  const handleKeyChange = (keyName: string, value: string) => {
    setLocalKeys((prev) => ({ ...prev, [keyName]: value }))
    setTestStatus((prev) => ({ ...prev, [keyName]: 'idle' }))
    onKeyChange(keyName, value)
  }

  const testProvider = async (keyName: string) => {
    const key = localKeys[keyName]
    if (!key) return
    setTestStatus((prev) => ({ ...prev, [keyName]: 'testing' }))
    try {
      const result = await api.marketData.testProvider(keyName, key)
      setTestStatus((prev) => ({ ...prev, [keyName]: result.ok ? 'ok' : 'error' }))
    } catch {
      setTestStatus((prev) => ({ ...prev, [keyName]: 'error' }))
    }
  }

  return (
    <ConfigSection
      title="Data Provider Keys"
      description="Low-frequency data — boards, economy, fundamentals — is served by the Data Hub. Add a key only to go direct, or to unlock the slice the hub doesn't serve (FMP fundamentals)."
    >
      <div className="space-y-4">
        {KEY_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="text-[11px] text-text-muted/60 uppercase tracking-wider border-t border-border/40 pt-3 mb-3">
                {group.label}
              </p>
            )}
            <div className="space-y-4">
              {group.providers.map(({ key, name, desc, hint }) => {
                const status = testStatus[key] || 'idle'
                const isFmp = key === 'fmp'
                return (
                  <div
                    key={key}
                    ref={isFmp ? fmpRef : undefined}
                    className={`rounded-lg transition-shadow ${isFmp && highlightFmp ? 'ring-2 ring-accent/60' : ''}`}
                  >
                    <Field label={name} description={hint}>
                      <p className="text-[12px] text-text-muted/70 mb-2">{desc}</p>
                      <div className="flex items-center gap-2">
                        <input
                          className={inputClass}
                          type="password"
                          value={localKeys[key]}
                          onChange={(e) => handleKeyChange(key, e.target.value)}
                          placeholder="Not configured"
                        />
                        <TestButton
                          status={status}
                          disabled={!localKeys[key] || status === 'testing'}
                          onClick={() => testProvider(key)}
                        />
                      </div>
                    </Field>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </ConfigSection>
  )
}
