import { useState } from 'react'
import { api, type AppConfig, type NewsCollectorConfig, type NewsCollectorFeed } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { SDKSelector, DATASOURCE_OPTIONS } from '../components/SDKSelector'
import { Section, Field, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import type { SaveStatus } from '../hooks/useAutoSave'

type OpenbbConfig = Record<string, unknown>

/** Combine two save statuses for the header indicator */
function combineStatus(a: SaveStatus, b: SaveStatus): SaveStatus {
  if (a === 'error' || b === 'error') return 'error'
  if (a === 'saving' || b === 'saving') return 'saving'
  if (a === 'saved' || b === 'saved') return 'saved'
  return 'idle'
}

export function DataSourcesPage() {
  const openbb = useConfigPage<OpenbbConfig>({
    section: 'openbb',
    extract: (full: AppConfig) => (full as Record<string, unknown>).openbb as OpenbbConfig,
  })

  const news = useConfigPage<NewsCollectorConfig>({
    section: 'newsCollector',
    extract: (full: AppConfig) => (full as Record<string, unknown>).newsCollector as NewsCollectorConfig,
  })

  const status = combineStatus(openbb.status, news.status)
  const loadError = openbb.loadError || news.loadError
  const retry = () => { openbb.retry(); news.retry() }

  // Derive selected data source IDs from enabled flags
  const selected: string[] = []
  if (openbb.config) {
    if ((openbb.config as Record<string, unknown>).enabled !== false) selected.push('openbb')
  } else {
    selected.push('openbb') // default enabled
  }
  if (news.config) {
    if (news.config.enabled !== false) selected.push('newsCollector')
  } else {
    selected.push('newsCollector') // default enabled
  }

  const handleToggle = (id: string) => {
    if (id === 'openbb' && openbb.config) {
      const cur = (openbb.config as Record<string, unknown>).enabled !== false
      openbb.updateConfigImmediate({ enabled: !cur } as Partial<OpenbbConfig>)
    } else if (id === 'newsCollector' && news.config) {
      news.updateConfigImmediate({ enabled: !news.config.enabled })
    }
  }

  const openbbEnabled = selected.includes('openbb')
  const newsEnabled = selected.includes('newsCollector')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Data Sources</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Market data and news feed configuration.
            </p>
          </div>
          <SaveIndicator status={status} onRetry={retry} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[640px] space-y-8">
          {/* Data source selector cards */}
          <Section
            title="Active Sources"
            description="Select which data sources to enable. Both are enabled by default."
          >
            <SDKSelector
              options={DATASOURCE_OPTIONS}
              selected={selected}
              onToggle={handleToggle}
            />
          </Section>

          {/* OpenBB section */}
          {openbbEnabled && openbb.config && (
            <>
              <ConnectionSection
                openbb={openbb.config}
                onChange={openbb.updateConfig}
                onChangeImmediate={openbb.updateConfigImmediate}
              />
              <ProviderKeysSection
                openbb={openbb.config}
                onChange={openbb.updateConfig}
              />
            </>
          )}

          {/* News Collector section */}
          {newsEnabled && news.config && (
            <>
              <NewsCollectorSettingsSection
                config={news.config}
                onChange={news.updateConfig}
                onChangeImmediate={news.updateConfigImmediate}
              />
              <FeedsSection
                feeds={news.config.feeds}
                onChange={(feeds) => news.updateConfigImmediate({ feeds })}
              />
            </>
          )}
        </div>
        {loadError && <p className="text-[13px] text-red mt-4">Failed to load configuration.</p>}
      </div>
    </div>
  )
}

// ==================== OpenBB: Connection ====================

const PROVIDER_OPTIONS: Record<string, string[]> = {
  equity: ['yfinance', 'fmp', 'intrinio', 'tiingo', 'alpha_vantage'],
  crypto: ['yfinance', 'fmp', 'tiingo'],
  currency: ['yfinance', 'fmp', 'tiingo'],
  newsCompany: ['yfinance', 'fmp', 'benzinga', 'intrinio'],
  newsWorld: ['fmp', 'benzinga', 'tiingo', 'biztoc', 'intrinio'],
}

const ASSET_LABELS: Record<string, string> = {
  equity: 'Equity',
  crypto: 'Crypto',
  currency: 'Currency',
  newsCompany: 'News (Company)',
  newsWorld: 'News (World)',
}

interface ConnectionSectionProps {
  openbb: OpenbbConfig
  onChange: (patch: Partial<OpenbbConfig>) => void
  onChangeImmediate: (patch: Partial<OpenbbConfig>) => void
}

function ConnectionSection({ openbb, onChange, onChangeImmediate }: ConnectionSectionProps) {
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const apiUrl = (openbb.apiUrl as string) || 'http://localhost:6900'
  const providers = (openbb.providers ?? { equity: 'yfinance', crypto: 'yfinance', currency: 'yfinance', newsCompany: 'yfinance', newsWorld: 'fmp' }) as Record<string, string>

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

  return (
    <Section
      title="OpenBB Connection"
      description="OpenBB sidecar API connection. Unless you changed the default setup, these should work as-is."
    >
      <Field label="API URL">
        <input
          className={inputClass}
          value={apiUrl}
          onChange={(e) => { onChange({ apiUrl: e.target.value }); setTestStatus('idle') }}
          placeholder="http://localhost:6900"
        />
      </Field>

      <div className="mb-3">
        <label className="block text-[13px] text-text-muted mb-1.5">Default Providers</label>
        <p className="text-[11px] text-text-muted/60 mb-2">Each asset class uses its own data provider. Commodity and economy endpoints use dedicated providers (FRED, EIA, BLS, etc.) per-endpoint.</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PROVIDER_OPTIONS).map(([asset, options]) => (
            <div key={asset}>
              <label className="block text-[11px] text-text-muted mb-0.5">{ASSET_LABELS[asset]}</label>
              <select
                className={inputClass}
                value={providers[asset] || 'yfinance'}
                onChange={(e) => onChangeImmediate({ providers: { ...providers, [asset]: e.target.value } })}
              >
                {options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={testConnection}
          disabled={testing}
          className={`border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-50 ${
            testStatus === 'ok'
              ? 'border-green text-green'
              : testStatus === 'error'
                ? 'border-red text-red'
                : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
          }`}
        >
          {testing ? 'Testing...' : testStatus === 'ok' ? 'Connected' : testStatus === 'error' ? 'Failed' : 'Test Connection'}
        </button>
        {testStatus !== 'idle' && (
          <div className={`w-2 h-2 rounded-full ${testStatus === 'ok' ? 'bg-green' : 'bg-red'}`} />
        )}
      </div>
    </Section>
  )
}

// ==================== OpenBB: Provider Keys ====================

const FREE_PROVIDERS = [
  { key: 'fred', name: 'FRED', desc: 'Federal Reserve Economic Data — CPI, GDP, interest rates, and thousands of macro indicators.', hint: 'Free — get your key at fredaccount.stlouisfed.org/apikeys' },
  { key: 'bls', name: 'BLS', desc: 'Bureau of Labor Statistics — employment, nonfarm payrolls, wages, and CPI by region.', hint: 'Free — register at registrationapps.bls.gov/bls_registration' },
  { key: 'eia', name: 'EIA', desc: 'Energy Information Administration — petroleum status, energy outlook reports.', hint: 'Free — register at eia.gov/opendata' },
  { key: 'econdb', name: 'EconDB', desc: 'Global macro indicators, country profiles, and port shipping data.', hint: 'Optional — works without key (limited). Register at econdb.com' },
] as const

const PAID_PROVIDERS = [
  { key: 'fmp', name: 'FMP', desc: 'Financial Modeling Prep — financial statements, fundamentals, economic calendar, news.', hint: 'Freemium — 250 req/day free at financialmodelingprep.com' },
  { key: 'benzinga', name: 'Benzinga', desc: 'Real-time news, analyst ratings and price targets.', hint: 'Paid — plans at benzinga.com' },
  { key: 'tiingo', name: 'Tiingo', desc: 'News and historical market data.', hint: 'Freemium — free tier at tiingo.com' },
  { key: 'biztoc', name: 'Biztoc', desc: 'Aggregated business and finance news.', hint: 'Freemium — register at biztoc.com' },
  { key: 'nasdaq', name: 'Nasdaq', desc: 'Nasdaq Data Link — dividend/earnings calendars, short interest.', hint: 'Freemium — sign up at data.nasdaq.com' },
  { key: 'intrinio', name: 'Intrinio', desc: 'Equity fundamentals, options data, institutional ownership.', hint: 'Paid — free trial at intrinio.com' },
  { key: 'tradingeconomics', name: 'Trading Economics', desc: 'Global economic calendar, 20M+ indicators across 196 countries.', hint: 'Paid — plans at tradingeconomics.com' },
] as const

const ALL_PROVIDER_KEYS = [...FREE_PROVIDERS, ...PAID_PROVIDERS].map((p) => p.key)

function ProviderKeysSection({
  openbb,
  onChange,
}: {
  openbb: OpenbbConfig
  onChange: (patch: Partial<OpenbbConfig>) => void
}) {
  const existing = (openbb.providerKeys ?? {}) as Record<string, string | undefined>
  const [keys, setKeys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const k of ALL_PROVIDER_KEYS) init[k] = existing[k] || ''
    return init
  })
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({})

  const setKey = (k: string, v: string) => {
    setKeys((prev) => ({ ...prev, [k]: v }))
    setTestStatus((prev) => ({ ...prev, [k]: 'idle' }))
    const updated = { ...keys, [k]: v }
    const providerKeys: Record<string, string> = {}
    for (const [key, val] of Object.entries(updated)) {
      if (val) providerKeys[key] = val
    }
    onChange({ providerKeys })
  }

  const testProvider = async (provider: string) => {
    const key = keys[provider]
    if (!key) return
    setTestStatus((prev) => ({ ...prev, [provider]: 'testing' }))
    try {
      const result = await api.openbb.testProvider(provider, key)
      setTestStatus((prev) => ({ ...prev, [provider]: result.ok ? 'ok' : 'error' }))
    } catch {
      setTestStatus((prev) => ({ ...prev, [provider]: 'error' }))
    }
  }

  const [expanded, setExpanded] = useState(false)
  const configuredCount = Object.values(keys).filter(Boolean).length

  const renderGroup = (label: string, providers: ReadonlyArray<{ key: string; name: string; desc: string; hint: string }>) => (
    <div className="mb-4">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">{label}</p>
      {providers.map(({ key, name, desc, hint }) => {
        const status = testStatus[key] || 'idle'
        return (
          <Field key={key} label={name}>
            <p className="text-[11px] text-text-muted mb-1">{desc}</p>
            <p className="text-[10px] text-text-muted/60 mb-1.5">{hint}</p>
            <div className="flex items-center gap-2">
              <input
                className={inputClass}
                type="password"
                value={keys[key]}
                onChange={(e) => setKey(key, e.target.value)}
                placeholder="Not configured"
              />
              <button
                onClick={() => testProvider(key)}
                disabled={!keys[key] || status === 'testing'}
                className={`shrink-0 border rounded-md px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${
                  status === 'ok'
                    ? 'border-green text-green'
                    : status === 'error'
                      ? 'border-red text-red'
                      : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
                }`}
              >
                {status === 'testing' ? '...' : status === 'ok' ? 'OK' : status === 'error' ? 'Fail' : 'Test'}
              </button>
            </div>
          </Field>
        )
      })}
    </div>
  )

  return (
    <div className="border-t border-border pt-5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-[13px] text-text-muted hover:text-text transition-colors w-full"
      >
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="font-semibold uppercase tracking-wide">Provider API Keys</span>
        <span className="text-[11px] ml-auto">
          {configuredCount > 0 ? `${configuredCount} configured` : 'None configured'}
        </span>
      </button>
      {expanded && (
        <div className="mt-3">
          <p className="text-[12px] text-text-muted mb-4">
            Optional data providers powered by OpenBB. The default yfinance covers equities, crypto and forex for free. Adding API keys here unlocks macro economic data (CPI, GDP, employment), energy reports, and expanded fundamentals.
          </p>
          {renderGroup('Free', FREE_PROVIDERS)}
          {renderGroup('Paid / Freemium', PAID_PROVIDERS)}
        </div>
      )}
    </div>
  )
}

// ==================== News Collector: Settings ====================

interface NewsSettingsProps {
  config: NewsCollectorConfig
  onChange: (patch: Partial<NewsCollectorConfig>) => void
  onChangeImmediate: (patch: Partial<NewsCollectorConfig>) => void
}

function NewsCollectorSettingsSection({ config, onChange, onChangeImmediate }: NewsSettingsProps) {
  return (
    <Section
      title="News Collector"
      description="RSS/Atom feed aggregation settings. Collected articles are searchable via globNews/grepNews/readNews tools."
    >
      <Field label="Fetch Interval (minutes)">
        <input
          className={inputClass}
          type="number"
          min={1}
          value={config.intervalMinutes}
          onChange={(e) => onChange({ intervalMinutes: Number(e.target.value) || 10 })}
        />
      </Field>

      <Field label="Retention (days)">
        <input
          className={inputClass}
          type="number"
          min={1}
          value={config.retentionDays}
          onChange={(e) => onChange({ retentionDays: Number(e.target.value) || 7 })}
        />
      </Field>

      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <span className="text-sm">Piggyback OpenBB</span>
          <p className="text-[11px] text-text-muted mt-0.5">
            Also capture results from newsGetWorld / newsGetCompany into the news store.
          </p>
        </div>
        <Toggle
          checked={config.piggybackOpenBB}
          onChange={(v) => onChangeImmediate({ piggybackOpenBB: v })}
        />
      </div>
    </Section>
  )
}

// ==================== News Collector: Feeds ====================

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

  const removeFeed = (index: number) => {
    onChange(feeds.filter((_, i) => i !== index))
  }

  const addFeed = () => {
    if (!newName.trim() || !newUrl.trim() || !newSource.trim()) return
    onChange([...feeds, { name: newName.trim(), url: newUrl.trim(), source: newSource.trim() }])
    setNewName('')
    setNewUrl('')
    setNewSource('')
  }

  return (
    <Section
      title="RSS Feeds"
      description="Add or remove RSS/Atom feeds. Changes take effect on the next fetch cycle."
    >
      {/* Existing feeds */}
      {feeds.length > 0 && (
        <div className="space-y-2 mb-4">
          {feeds.map((feed, i) => (
            <div
              key={`${feed.source}-${i}`}
              className="flex items-center gap-3 border border-border rounded-lg px-3 py-2.5"
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
        <p className="text-[12px] text-text-muted mb-4">No feeds configured.</p>
      )}

      {/* Add feed form */}
      <div className="border border-border/60 rounded-lg p-3 space-y-2">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Add Feed</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">Name</label>
            <input
              className={inputClass}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. CoinDesk"
            />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">Source Tag</label>
            <input
              className={inputClass}
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              placeholder="e.g. coindesk"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">Feed URL</label>
          <input
            className={inputClass}
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/rss.xml"
          />
        </div>
        <button
          onClick={addFeed}
          disabled={!newName.trim() || !newUrl.trim() || !newSource.trim()}
          className="border border-border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted disabled:opacity-40 disabled:cursor-default"
        >
          Add Feed
        </button>
      </div>
    </Section>
  )
}
