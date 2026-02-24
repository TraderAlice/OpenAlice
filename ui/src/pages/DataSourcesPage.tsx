import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type AppConfig } from '../api'

const inputClass =
  'w-full px-2.5 py-2 bg-bg text-text border border-border rounded-md font-sans text-sm outline-none transition-colors focus:border-accent'

export function DataSourcesPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2000)
  }, [])

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => showToast('Failed to load config', true))
  }, [showToast])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const saveOpenbb = useCallback(
    async (data: unknown, label: string) => {
      try {
        await api.config.updateSection('openbb', data)
        showToast(`${label} updated`)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Save failed', true)
      }
    },
    [showToast],
  )

  const openbb = config
    ? ((config as Record<string, unknown>).openbb as Record<string, unknown> | undefined)
    : undefined

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4">
          <h2 className="text-base font-semibold text-text">Data Sources</h2>
          <p className="text-[12px] text-text-muted mt-1">
            Market data powered by OpenBB. The default provider yfinance is free and works out of the box.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && openbb && (
          <div className="max-w-[640px] space-y-8">
            {/* Connection */}
            <ConnectionSection openbb={openbb} onSave={saveOpenbb} showToast={showToast} />

            {/* Provider Keys */}
            <ProviderKeysSection openbb={openbb} onSave={saveOpenbb} />
          </div>
        )}
      </div>

      {/* Toast */}
      <div
        className={`fixed bottom-20 left-1/2 -translate-x-1/2 bg-bg-tertiary text-text border border-border px-4 py-2 rounded-lg text-[13px] z-[200] transition-all duration-300 pointer-events-none ${
          toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
        } ${toast?.error ? 'border-red text-red' : ''}`}
      >
        {toast?.msg}
      </div>
    </div>
  )
}

// ==================== Sections ====================

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">
        {title}
      </h3>
      {description && (
        <p className="text-[12px] text-text-muted mt-1">{description}</p>
      )}
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

function SaveButton({ onClick, label = 'Save' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="bg-user-bubble text-white rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-opacity hover:opacity-85 mt-1"
    >
      {label}
    </button>
  )
}

// ==================== Connection ====================

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

function ConnectionSection({
  openbb,
  onSave,
  showToast,
}: {
  openbb: Record<string, unknown>
  onSave: (data: unknown, label: string) => void
  showToast: (msg: string, error?: boolean) => void
}) {
  const [apiUrl, setApiUrl] = useState((openbb.apiUrl as string) || 'http://localhost:6900')
  const existingProviders = (openbb.providers ?? {}) as Record<string, string>
  const [providers, setProviders] = useState<Record<string, string>>({
    equity: existingProviders.equity || 'yfinance',
    crypto: existingProviders.crypto || 'yfinance',
    currency: existingProviders.currency || 'yfinance',
  })
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const setProvider = (asset: string, value: string) => {
    setProviders((prev) => ({ ...prev, [asset]: value }))
  }

  const testConnection = async () => {
    setTesting(true)
    setStatus('idle')
    try {
      const res = await fetch(`${apiUrl}/api/v1/equity/search?query=AAPL&provider=sec`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        setStatus('ok')
      } else {
        setStatus('error')
        showToast(`OpenBB returned ${res.status}`, true)
      }
    } catch {
      setStatus('error')
      showToast('Cannot reach OpenBB API', true)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title="Connection"
        description="OpenBB sidecar API connection. Unless you changed the default setup, these should work as-is."
      />
      <Field label="API URL">
        <input className={inputClass} value={apiUrl} onChange={(e) => { setApiUrl(e.target.value); setStatus('idle') }} placeholder="http://localhost:6900" />
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
                value={providers[asset]}
                onChange={(e) => setProvider(asset, e.target.value)}
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
        <SaveButton onClick={() => onSave({ ...openbb, apiUrl, providers }, 'Connection')} />
        <button
          onClick={testConnection}
          disabled={testing}
          className={`border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-50 ${
            status === 'ok'
              ? 'border-green text-green'
              : status === 'error'
                ? 'border-red text-red'
                : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
          }`}
        >
          {testing ? 'Testing...' : status === 'ok' ? 'Connected' : status === 'error' ? 'Failed' : 'Test Connection'}
        </button>
        {status !== 'idle' && (
          <div className={`w-2 h-2 rounded-full ${status === 'ok' ? 'bg-green' : 'bg-red'}`} />
        )}
      </div>
    </div>
  )
}

// ==================== Provider Keys ====================

const FREE_PROVIDERS = [
  { key: 'fred', name: 'FRED', desc: 'Federal Reserve Economic Data — CPI, GDP, interest rates, and thousands of macro indicators.', hint: 'Free — get your key at fredaccount.stlouisfed.org/apikeys' },
  { key: 'bls', name: 'BLS', desc: 'Bureau of Labor Statistics — employment, nonfarm payrolls, wages, and CPI by region.', hint: 'Free — register at registrationapps.bls.gov/bls_registration' },
  { key: 'eia', name: 'EIA', desc: 'Energy Information Administration — petroleum status, energy outlook reports.', hint: 'Free — register at eia.gov/opendata' },
  { key: 'econdb', name: 'EconDB', desc: 'Global macro indicators, country profiles, and port shipping data.', hint: 'Optional — works without key (limited). Register at econdb.com' },
] as const

const PAID_PROVIDERS = [
  { key: 'fmp', name: 'FMP', desc: 'Financial Modeling Prep — financial statements, fundamentals, economic calendar.', hint: 'Freemium — 250 req/day free at financialmodelingprep.com' },
  { key: 'nasdaq', name: 'Nasdaq', desc: 'Nasdaq Data Link — dividend/earnings calendars, short interest.', hint: 'Freemium — sign up at data.nasdaq.com' },
  { key: 'intrinio', name: 'Intrinio', desc: 'Equity fundamentals, options data, institutional ownership.', hint: 'Paid — free trial at intrinio.com' },
  { key: 'tradingeconomics', name: 'Trading Economics', desc: 'Global economic calendar, 20M+ indicators across 196 countries.', hint: 'Paid — plans at tradingeconomics.com' },
] as const

const ALL_PROVIDER_KEYS = [...FREE_PROVIDERS, ...PAID_PROVIDERS].map((p) => p.key)

function ProviderKeysSection({
  openbb,
  onSave,
}: {
  openbb: Record<string, unknown>
  onSave: (data: unknown, label: string) => void
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

  const buildProviderKeys = () => {
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(keys)) {
      if (v) result[k] = v
    }
    return result
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
          <SaveButton onClick={() => onSave({ ...openbb, providerKeys: buildProviderKeys() }, 'Provider keys')} />
        </div>
      )}
    </div>
  )
}
