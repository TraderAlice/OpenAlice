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
  const [defaultProvider, setDefaultProvider] = useState((openbb.defaultProvider as string) || 'yfinance')
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')

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
      <Field label="Default Provider">
        <input className={inputClass} value={defaultProvider} onChange={(e) => setDefaultProvider(e.target.value)} placeholder="yfinance" />
      </Field>
      <div className="flex items-center gap-2 mt-1">
        <SaveButton onClick={() => onSave({ ...openbb, apiUrl, defaultProvider }, 'Connection')} />
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

const PROVIDERS = [
  { key: 'fred', name: 'FRED', desc: 'Federal Reserve Economic Data — commodity spot prices' },
  { key: 'fmp', name: 'FMP', desc: 'Financial Modeling Prep — fundamentals, crypto search' },
  { key: 'eia', name: 'EIA', desc: 'Energy Information Administration — petroleum & energy reports' },
] as const

function ProviderKeysSection({
  openbb,
  onSave,
}: {
  openbb: Record<string, unknown>
  onSave: (data: unknown, label: string) => void
}) {
  const existing = (openbb.providerKeys ?? {}) as Record<string, string | undefined>
  const [keys, setKeys] = useState<Record<string, string>>({
    fred: existing.fred || '',
    fmp: existing.fmp || '',
    eia: existing.eia || '',
  })

  const setKey = (k: string, v: string) => setKeys((prev) => ({ ...prev, [k]: v }))

  const buildProviderKeys = () => {
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(keys)) {
      if (v) result[k] = v
    }
    return result
  }

  const [expanded, setExpanded] = useState(false)
  const configuredCount = Object.values(keys).filter(Boolean).length

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
          <p className="text-[12px] text-text-muted mb-3">
            Optional third-party data providers supported by OpenBB. These are NOT required — the default yfinance provider covers equities, crypto and forex for free. Adding keys here unlocks extra data sources like commodity prices and energy reports.
          </p>
          {PROVIDERS.map(({ key, name, desc }) => (
            <Field key={key} label={name}>
              <p className="text-[11px] text-text-muted mb-1.5">{desc}</p>
              <input
                className={inputClass}
                type="password"
                value={keys[key]}
                onChange={(e) => setKey(key, e.target.value)}
                placeholder="Not configured"
              />
            </Field>
          ))}
          <SaveButton onClick={() => onSave({ ...openbb, providerKeys: buildProviderKeys() }, 'Provider keys')} />
        </div>
      )}
    </div>
  )
}
