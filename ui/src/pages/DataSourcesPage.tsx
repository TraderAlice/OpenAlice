import { useState } from 'react'
import { api, type AppConfig, type NewsCollectorConfig, type NewsCollectorFeed } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { Field, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import { PageHeader } from '../components/PageHeader'
import type { SaveStatus } from '../hooks/useAutoSave'

type OpenbbConfig = Record<string, unknown>

function combineStatus(a: SaveStatus, b: SaveStatus): SaveStatus {
  if (a === 'error' || b === 'error') return 'error'
  if (a === 'saving' || b === 'saving') return 'saving'
  if (a === 'saved' || b === 'saved') return 'saved'
  return 'idle'
}

// ==================== Constants ====================

const PROVIDER_OPTIONS: Record<string, string[]> = {
  equity: ['yfinance', 'fmp', 'intrinio', 'tiingo', 'alpha_vantage'],
  crypto: ['yfinance', 'fmp', 'tiingo'],
  currency: ['yfinance', 'fmp', 'tiingo'],
}

const ASSET_LABELS: Record<string, string> = {
  equity: 'Equity',
  crypto: 'Crypto',
  currency: 'Currency',
}

/** Maps provider name → providerKeys key. null means free, no key required. */
const PROVIDER_KEY_MAP: Record<string, string | null> = {
  yfinance: null,
  fmp: 'fmp',
  intrinio: 'intrinio',
  tiingo: 'tiingo',
  alpha_vantage: 'alpha_vantage',
  benzinga: 'benzinga',
  biztoc: 'biztoc',
}

/** Macro/utility providers used by dedicated endpoints (not per-asset-class selectable) */
const UTILITY_PROVIDERS = [
  { key: 'fred', name: 'FRED', desc: 'Federal Reserve Economic Data — CPI, GDP, interest rates, macro indicators.', hint: 'Free — fredaccount.stlouisfed.org/apikeys' },
  { key: 'bls', name: 'BLS', desc: 'Bureau of Labor Statistics — employment, payrolls, wages, CPI.', hint: 'Free — registrationapps.bls.gov/bls_registration' },
  { key: 'eia', name: 'EIA', desc: 'Energy Information Administration — petroleum status, energy reports.', hint: 'Free — eia.gov/opendata' },
  { key: 'econdb', name: 'EconDB', desc: 'Global macro indicators, country profiles, shipping data.', hint: 'Optional — works without key (limited). econdb.com' },
  { key: 'nasdaq', name: 'Nasdaq', desc: 'Nasdaq Data Link — dividend/earnings calendars, short interest.', hint: 'Freemium — data.nasdaq.com' },
  { key: 'tradingeconomics', name: 'Trading Economics', desc: '20M+ indicators across 196 countries, economic calendar.', hint: 'Paid — tradingeconomics.com' },
] as const

// ==================== Zone ====================

interface ZoneProps {
  title: string
  subtitle: string
  badge?: string
  enabled: boolean
  onToggle: () => void
  children: React.ReactNode
}

function Zone({ title, subtitle, badge, enabled, onToggle, children }: ZoneProps) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between bg-bg-secondary border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-text">{title}</h3>
            {badge && (
              <span className="text-[10px] font-medium text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">{subtitle}</p>
        </div>
        <Toggle size="sm" checked={enabled} onChange={onToggle} />
      </div>
      <div className={enabled ? 'px-4 py-4' : 'px-4 py-4 opacity-40 pointer-events-none'}>
        {children}
      </div>
    </div>
  )
}

// ==================== Market Data Engine ====================

interface AssetProviderGridProps {
  providers: Record<string, string>
  providerKeys: Record<string, string>
  onProviderChange: (asset: string, provider: string) => void
  onKeyChange: (keyName: string, value: string) => void
}

function AssetProviderGrid({ providers, providerKeys, onProviderChange, onKeyChange }: AssetProviderGridProps) {
  const [localKeys, setLocalKeys] = useState<Record<string, string>>(() => ({ ...providerKeys }))
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({})

  const handleKeyChange = (keyName: string, value: string) => {
    setLocalKeys((prev) => ({ ...prev, [keyName]: value }))
    setTestStatus((prev) => ({ ...prev, [keyName]: 'idle' }))
    onKeyChange(keyName, value)
  }

  const testProvider = async (provider: string, keyName: string) => {
    const key = localKeys[keyName]
    if (!key) return
    setTestStatus((prev) => ({ ...prev, [keyName]: 'testing' }))
    try {
      const result = await api.marketData.testProvider(provider, key)
      setTestStatus((prev) => ({ ...prev, [keyName]: result.ok ? 'ok' : 'error' }))
    } catch {
      setTestStatus((prev) => ({ ...prev, [keyName]: 'error' }))
    }
  }

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-2">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">Asset Providers</p>
      {Object.entries(PROVIDER_OPTIONS).map(([asset, options]) => {
        const selectedProvider = providers[asset] || options[0]
        const keyName = PROVIDER_KEY_MAP[selectedProvider] ?? null
        const status = keyName ? (testStatus[keyName] || 'idle') : 'idle'

        return (
          <div key={asset} className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted w-28 shrink-0">{ASSET_LABELS[asset]}</span>
            <select
              className={inputClass}
              value={selectedProvider}
              onChange={(e) => onProviderChange(asset, e.target.value)}
            >
              {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            {keyName ? (
              <>
                <input
                  className={inputClass}
                  type="password"
                  value={localKeys[keyName] || ''}
                  onChange={(e) => handleKeyChange(keyName, e.target.value)}
                  placeholder="API key"
                />
                <button
                  onClick={() => testProvider(selectedProvider, keyName)}
                  disabled={!localKeys[keyName] || status === 'testing'}
                  className={`shrink-0 border rounded-md px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${
                    status === 'ok'
                      ? 'border-green text-green'
                      : status === 'error'
                        ? 'border-red text-red'
                        : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
                  }`}
                >
                  {status === 'testing' ? '…' : status === 'ok' ? 'OK' : status === 'error' ? 'Fail' : 'Test'}
                </button>
              </>
            ) : (
              <span className="text-[11px] text-text-muted/50 px-2.5">Free</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface UtilityProvidersSectionProps {
  providerKeys: Record<string, string>
  onKeyChange: (keyName: string, value: string) => void
}

function UtilityProvidersSection({ providerKeys, onKeyChange }: UtilityProvidersSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [localKeys, setLocalKeys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const p of UTILITY_PROVIDERS) init[p.key] = providerKeys[p.key] || ''
    return init
  })
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({})

  const configuredCount = Object.values(localKeys).filter(Boolean).length

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
    <div className="border-t border-border pt-4 mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text transition-colors w-full"
      >
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="font-semibold uppercase tracking-wide">Macro & Utility Providers</span>
        <span className="text-[11px] ml-auto">
          {configuredCount > 0 ? `${configuredCount} configured` : 'None configured'}
        </span>
      </button>
      {expanded && (
        <div className="mt-3">
          <p className="text-[12px] text-text-muted mb-3">
            Used by dedicated macro endpoints (FRED for CPI/GDP, BLS for employment, EIA for energy). Not per-asset-class selectable.
          </p>
          <div className="space-y-3">
            {UTILITY_PROVIDERS.map(({ key, name, desc, hint }) => {
              const status = testStatus[key] || 'idle'
              return (
                <Field key={key} label={name}>
                  <p className="text-[11px] text-text-muted mb-0.5">{desc}</p>
                  <p className="text-[10px] text-text-muted/60 mb-1.5">{hint}</p>
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      type="password"
                      value={localKeys[key]}
                      onChange={(e) => handleKeyChange(key, e.target.value)}
                      placeholder="Not configured"
                    />
                    <button
                      onClick={() => testProvider(key)}
                      disabled={!localKeys[key] || status === 'testing'}
                      className={`shrink-0 border rounded-md px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${
                        status === 'ok'
                          ? 'border-green text-green'
                          : status === 'error'
                            ? 'border-red text-red'
                            : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
                      }`}
                    >
                      {status === 'testing' ? '…' : status === 'ok' ? 'OK' : status === 'error' ? 'Fail' : 'Test'}
                    </button>
                  </div>
                </Field>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface MarketDataZoneProps {
  openbb: OpenbbConfig
  enabled: boolean
  onToggle: () => void
  onChange: (patch: Partial<OpenbbConfig>) => void
  onChangeImmediate: (patch: Partial<OpenbbConfig>) => void
}

function MarketDataZone({ openbb, enabled, onToggle, onChange, onChangeImmediate }: MarketDataZoneProps) {
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const dataBackend = (openbb.backend as string) || 'typebb-sdk'
  const apiUrl = (openbb.apiUrl as string) || 'http://localhost:6900'
  const apiServer = (openbb.apiServer as { enabled: boolean; port: number } | undefined) ?? { enabled: false, port: 6901 }
  const providers = (openbb.providers ?? {
    equity: 'yfinance', crypto: 'yfinance', currency: 'yfinance',
  }) as Record<string, string>
  const providerKeys = (openbb.providerKeys ?? {}) as Record<string, string>

  const testConnection = async () => {
    setTesting(true)
    setTestStatus('idle')
    try {
      const res = await fetch(`${apiUrl}/api/v1/equity/search?query=AAPL&provider=sec`, { signal: AbortSignal.timeout(5000) })
      setTestStatus(res.ok ? 'ok' : 'error')
    } catch {
      setTestStatus('error')
    } finally {
      setTesting(false)
    }
  }

  const handleProviderChange = (asset: string, provider: string) => {
    onChangeImmediate({ providers: { ...providers, [asset]: provider } })
  }

  const handleKeyChange = (keyName: string, value: string) => {
    const all = (openbb.providerKeys ?? {}) as Record<string, string>
    const updated = { ...all, [keyName]: value }
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(updated)) {
      if (v) cleaned[k] = v
    }
    onChange({ providerKeys: cleaned })
  }

  return (
    <Zone
      title="Market Data"
      subtitle="Structured financial data — prices, fundamentals, macro indicators."
      enabled={enabled}
      onToggle={onToggle}
    >
      {/* Backend selector */}
      <div>
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Data Backend</p>
        <div className="flex border border-border rounded-lg overflow-hidden w-fit">
          {(['typebb-sdk', 'openbb-api'] as const).map((backend, i) => (
            <button
              key={backend}
              onClick={() => { onChangeImmediate({ backend }); setTestStatus('idle') }}
              className={`px-4 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                i > 0 ? 'border-l border-border' : ''
              } ${
                dataBackend === backend
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {backend === 'typebb-sdk' ? 'Built-in Engine (TypeBB)' : 'External OpenBB API'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-1.5">
          {dataBackend === 'typebb-sdk'
            ? 'Uses the built-in TypeBB engine. No external process required.'
            : 'Connects to an external OpenBB-compatible HTTP endpoint.'}
        </p>
      </div>

      {/* Connection — only shown for external OpenBB backend */}
      {dataBackend === 'openbb-api' && (
        <div className="border-t border-border pt-4 mt-2">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Connection</p>
          <div className="flex items-center gap-2">
            <input
              className={`${inputClass} flex-1`}
              value={apiUrl}
              onChange={(e) => { onChange({ apiUrl: e.target.value }); setTestStatus('idle') }}
              placeholder="http://localhost:6900"
            />
            <button
              onClick={testConnection}
              disabled={testing}
              className={`shrink-0 border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-50 ${
                testStatus === 'ok'
                  ? 'border-green text-green'
                  : testStatus === 'error'
                    ? 'border-red text-red'
                    : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
              }`}
            >
              {testing ? 'Testing…' : testStatus === 'ok' ? 'Connected' : testStatus === 'error' ? 'Failed' : 'Test Connection'}
            </button>
            {testStatus !== 'idle' && (
              <div className={`w-2 h-2 rounded-full shrink-0 ${testStatus === 'ok' ? 'bg-green' : 'bg-red'}`} />
            )}
          </div>
        </div>
      )}

      {/* Asset providers + inline keys */}
      <AssetProviderGrid
        providers={providers}
        providerKeys={providerKeys}
        onProviderChange={handleProviderChange}
        onKeyChange={handleKeyChange}
      />

      {/* Embedded API server */}
      <div className="border-t border-border pt-4 mt-2">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Embedded API Server</p>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-[13px] text-text">Expose OpenBB HTTP API</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Start an OpenBB-compatible HTTP server at Alice startup. Other services can connect to{' '}
              <span className="font-mono text-[10px]">http://localhost:{apiServer.port}</span>.
            </p>
            {apiServer.enabled && (
              <div className="flex items-center gap-2 mt-2">
                <label className="text-[11px] text-text-muted shrink-0">Port</label>
                <input
                  className={`${inputClass} w-24`}
                  type="number"
                  min={1024}
                  max={65535}
                  value={apiServer.port}
                  onChange={(e) => onChange({ apiServer: { ...apiServer, port: Number(e.target.value) || 6901 } })}
                />
              </div>
            )}
          </div>
          <Toggle
            size="sm"
            checked={apiServer.enabled}
            onChange={(v) => onChangeImmediate({ apiServer: { ...apiServer, enabled: v } })}
          />
        </div>
      </div>

      {/* Utility/macro providers */}
      <UtilityProvidersSection
        providerKeys={providerKeys}
        onKeyChange={handleKeyChange}
      />
    </Zone>
  )
}

// ==================== Open Intelligence ====================

function FeedsSection({
  feeds,
  onChange,
}: {
  feeds: NewsCollectorFeed[]
  onChange: (feeds: NewsCollectorFeed[]) => void
}) {
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newSource, setNewSource] = useState('')

  const removeFeed = (index: number) => onChange(feeds.filter((_, i) => i !== index))

  const addFeed = () => {
    if (!newName.trim() || !newUrl.trim() || !newSource.trim()) return
    onChange([...feeds, { name: newName.trim(), url: newUrl.trim(), source: newSource.trim() }])
    setNewName('')
    setNewUrl('')
    setNewSource('')
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">RSS Feeds</p>
      <p className="text-[11px] text-text-muted mb-3">
        Collected articles are searchable via globNews / grepNews / readNews. Changes take effect on the next fetch cycle.
      </p>

      {/* Existing feeds */}
      {feeds.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {feeds.map((feed, i) => (
            <div
              key={`${feed.source}-${i}`}
              className="flex items-center gap-3 border border-border rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-text truncate">{feed.name}</p>
                <p className="text-[11px] text-text-muted truncate">{feed.url}</p>
                <p className="text-[10px] text-text-muted/60 mt-0.5">source: {feed.source}</p>
              </div>
              <button
                onClick={() => removeFeed(i)}
                className="shrink-0 text-text-muted hover:text-red transition-colors p-1"
                title="Remove feed"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {feeds.length === 0 && (
        <p className="text-[12px] text-text-muted mb-3">No feeds configured.</p>
      )}

      {/* Add feed form */}
      <div className="border border-border/60 rounded-lg p-3 space-y-2">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Add Feed</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">Name</label>
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. CoinDesk" />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">Source Tag</label>
            <input className={inputClass} value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="e.g. coindesk" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">Feed URL</label>
          <input className={inputClass} value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://example.com/rss.xml" />
        </div>
        <button
          onClick={addFeed}
          disabled={!newName.trim() || !newUrl.trim() || !newSource.trim()}
          className="border border-border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted disabled:opacity-40 disabled:cursor-default"
        >
          Add Feed
        </button>
      </div>
    </div>
  )
}

interface CompactNewsSettingsProps {
  config: NewsCollectorConfig
  onChange: (patch: Partial<NewsCollectorConfig>) => void
  onChangeImmediate: (patch: Partial<NewsCollectorConfig>) => void
}

function CompactNewsSettings({ config, onChange }: CompactNewsSettingsProps) {
  return (
    <div className="border-t border-border pt-4 mt-4">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">Settings</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">Fetch interval (min)</label>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={config.intervalMinutes}
            onChange={(e) => onChange({ intervalMinutes: Number(e.target.value) || 10 })}
          />
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">Retention (days)</label>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={config.retentionDays}
            onChange={(e) => onChange({ retentionDays: Number(e.target.value) || 7 })}
          />
        </div>
      </div>
    </div>
  )
}

interface OpenIntelligenceZoneProps {
  config: NewsCollectorConfig
  enabled: boolean
  onToggle: () => void
  onChange: (patch: Partial<NewsCollectorConfig>) => void
  onChangeImmediate: (patch: Partial<NewsCollectorConfig>) => void
}

function OpenIntelligenceZone({ config, enabled, onToggle, onChange, onChangeImmediate }: OpenIntelligenceZoneProps) {
  const badge = config.feeds.length > 0 ? `${config.feeds.length} feeds` : undefined

  return (
    <Zone
      title="News"
      subtitle="RSS feeds & news archive — collect and search."
      badge={badge}
      enabled={enabled}
      onToggle={onToggle}
    >
      <FeedsSection
        feeds={config.feeds}
        onChange={(feeds) => onChangeImmediate({ feeds })}
      />
      <CompactNewsSettings
        config={config}
        onChange={onChange}
        onChangeImmediate={onChangeImmediate}
      />
    </Zone>
  )
}

// ==================== Page ====================

const DEFAULT_NEWS_CONFIG: NewsCollectorConfig = {
  enabled: true,
  intervalMinutes: 10,
  maxInMemory: 2000,
  retentionDays: 7,
  feeds: [],
}

export function DataSourcesPage() {
  const openbb = useConfigPage<OpenbbConfig>({
    section: 'marketData',
    extract: (full: AppConfig) => (full as Record<string, unknown>).marketData as OpenbbConfig,
  })

  const news = useConfigPage<NewsCollectorConfig>({
    section: 'news',
    extract: (full: AppConfig) => (full as Record<string, unknown>).news as NewsCollectorConfig,
  })

  const status = combineStatus(openbb.status, news.status)
  const loadError = openbb.loadError || news.loadError
  const retry = () => { openbb.retry(); news.retry() }

  const openbbEnabled = !openbb.config || (openbb.config as Record<string, unknown>).enabled !== false
  const newsEnabled = !news.config || news.config.enabled !== false

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Data Sources"
        description="Market data and news feed configuration."
        right={<SaveIndicator status={status} onRetry={retry} />}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[640px] space-y-6">
          {/* Market Data Engine zone */}
          {openbb.config ? (
            <MarketDataZone
              openbb={openbb.config}
              enabled={openbbEnabled}
              onToggle={() => openbb.updateConfigImmediate({ enabled: !openbbEnabled } as Partial<OpenbbConfig>)}
              onChange={openbb.updateConfig}
              onChangeImmediate={openbb.updateConfigImmediate}
            />
          ) : (
            <Zone
              title="Market Data"
              subtitle="Structured financial data — prices, fundamentals, macro indicators."
              enabled={true}
              onToggle={() => {}}
            >
              <p className="text-[12px] text-text-muted">Loading…</p>
            </Zone>
          )}

          {/* Open Intelligence zone */}
          {news.config ? (
            <OpenIntelligenceZone
              config={news.config}
              enabled={newsEnabled}
              onToggle={() => news.updateConfigImmediate({ enabled: !newsEnabled })}
              onChange={news.updateConfig}
              onChangeImmediate={news.updateConfigImmediate}
            />
          ) : (
            <Zone
              title="News"
              subtitle="RSS feeds & news archive — collect and search."
              enabled={true}
              onToggle={() => {}}
            >
              <p className="text-[12px] text-text-muted">Loading…</p>
            </Zone>
          )}
        </div>
        {loadError && <p className="text-[13px] text-red mt-4">Failed to load configuration.</p>}
      </div>
    </div>
  )
}
