import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type AppConfig } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import { PageHeader } from '../components/PageHeader'

type MarketDataConfig = Record<string, unknown>

// ==================== Constants ====================

const PROVIDER_OPTIONS: Record<string, string[]> = {
  equity: ['yfinance', 'fmp', 'intrinio'],
  crypto: ['yfinance', 'fmp'],
  currency: ['yfinance', 'fmp'],
  commodity: ['yfinance', 'fmp'],
}

const ASSET_LABELS: Record<string, string> = {
  equity: 'Equity',
  crypto: 'Crypto',
  currency: 'Currency',
  commodity: 'Commodity',
}

const ALL_PROVIDERS = [
  { key: 'fmp', name: 'FMP', desc: 'Equity, crypto, currency, commodity, ETF, index — fundamentals, calendars, discovery.', hint: 'financialmodelingprep.com' },
  { key: 'fred', name: 'FRED', desc: 'Federal Reserve Economic Data — CPI, GDP, interest rates, macro indicators.', hint: 'Free — fred.stlouisfed.org → My Account → API Keys' },
  { key: 'bls', name: 'BLS', desc: 'Bureau of Labor Statistics — employment, payrolls, wages, CPI.', hint: 'Free — data.bls.gov/registrationEngine/' },
  { key: 'eia', name: 'EIA', desc: 'Energy Information Administration — petroleum status, energy reports.', hint: 'Free — eia.gov/opendata/register.php' },
  { key: 'econdb', name: 'EconDB', desc: 'Global macro indicators, country profiles, shipping data.', hint: 'Required (free signup) — econdb.com' },
  { key: 'intrinio', name: 'Intrinio', desc: 'Equities, ETFs, fundamentals, news, options snapshots.', hint: 'intrinio.com' },
] as const

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
  const { t } = useTranslation()
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
      {status === 'testing' ? '...' : status === 'ok' ? t('dev.ok', 'OK') : status === 'error' ? t('common.failed', 'Fail') : t('common.test')}
    </button>
  )
}

// ==================== Page ====================

export function MarketDataPage() {
  const { t } = useTranslation()
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } = useConfigPage<MarketDataConfig>({
    section: 'marketData',
    extract: (full: AppConfig) => (full as Record<string, unknown>).marketData as MarketDataConfig,
  })

  const enabled = !config || (config as Record<string, unknown>).enabled !== false

  if (!config) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PageHeader title={t('market.data')} description={t('market.dataDescription', 'Structured financial data — prices, fundamentals, macro indicators.')} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  const dataBackend = (config.backend as string) || 'typebb-sdk'
  const apiUrl = (config.apiUrl as string) || 'http://localhost:6900'
  const providers = (config.providers ?? { equity: 'yfinance', crypto: 'yfinance', currency: 'yfinance', commodity: 'yfinance' }) as Record<string, string>
  const providerKeys = (config.providerKeys ?? {}) as Record<string, string>

  const handleProviderChange = (asset: string, provider: string) => {
    updateConfigImmediate({ providers: { ...providers, [asset]: provider } })
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.data')}
        description={t('market.dataDescription', 'Structured financial data — prices, fundamentals, macro indicators.')}
        right={
          <div className="flex items-center gap-3">
            <SaveIndicator status={status} onRetry={retry} />
            <Toggle size="sm" checked={enabled} onChange={(v) => updateConfigImmediate({ enabled: v })} />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
        <div className={`max-w-[880px] mx-auto ${!enabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {/* Asset Providers — route selection only, no keys */}
          <AssetProvidersSection
            providers={providers}
            onProviderChange={handleProviderChange}
          />

          {/* API Keys — unified credential management */}
          <ApiKeysSection
            providerKeys={providerKeys}
            onKeyChange={handleKeyChange}
          />

          {/* Advanced — backend switch */}
          <AdvancedSection
            backend={dataBackend}
            apiUrl={apiUrl}
            onBackendChange={(backend) => updateConfigImmediate({ backend })}
            onApiUrlChange={(url) => updateConfig({ apiUrl: url })}
          />
        </div>
        {loadError && <p className="text-[13px] text-red mt-4 max-w-[880px] mx-auto">{t('common.failedToLoad')}</p>}
      </div>
    </div>
  )
}

// ==================== Asset Providers Section ====================

function AssetProvidersSection({
  providers,
  onProviderChange,
}: {
  providers: Record<string, string>
  onProviderChange: (asset: string, provider: string) => void
}) {
  const { t } = useTranslation()
  return (
    <ConfigSection
      title={t('market.assetProviders', 'Asset Providers')}
      description={t('market.assetProvidersDescription', 'Select a data provider for each asset class. API keys are managed separately below.')}
    >
      <div className="space-y-3">
        {Object.entries(PROVIDER_OPTIONS).map(([asset, options]) => {
          const selectedProvider = providers[asset] || options[0]
          return (
            <div key={asset} className="flex items-center gap-3">
              <span className="text-[13px] text-text w-24 shrink-0 font-medium">{ASSET_LABELS[asset]}</span>
              <select
                className={`${inputClass} max-w-[180px]`}
                value={selectedProvider}
                onChange={(e) => onProviderChange(asset, e.target.value)}
              >
                {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
              {selectedProvider === 'yfinance' && (
                <span className="text-[13px] text-text-muted/50 px-1">{t('common.free', 'Free')}</span>
              )}
            </div>
          )
        })}
      </div>
    </ConfigSection>
  )
}

// ==================== API Keys Section ====================

function ApiKeysSection({
  providerKeys,
  onKeyChange,
}: {
  providerKeys: Record<string, string>
  onKeyChange: (keyName: string, value: string) => void
}) {
  const { t } = useTranslation()
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
      title={t('market.apiKeys', 'API Keys')}
      description={t('market.apiKeysDescription', 'Manage credentials for data providers. Keys are used across all asset classes that route to the provider.')}
    >
      <div className="space-y-4">
        {ALL_PROVIDERS.map(({ key, name, desc, hint }) => {
          const status = testStatus[key] || 'idle'
          return (
            <Field key={key} label={name} description={hint}>
              <p className="text-[12px] text-text-muted/70 mb-2">{desc}</p>
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  type="password"
                  value={localKeys[key]}
                  onChange={(e) => handleKeyChange(key, e.target.value)}
                  placeholder={t('market.notConfigured', 'Not configured')}
                />
                <TestButton
                  status={status}
                  disabled={!localKeys[key] || status === 'testing'}
                  onClick={() => testProvider(key)}
                />
              </div>
            </Field>
          )
        })}
      </div>
    </ConfigSection>
  )
}

// ==================== Advanced Section ====================

function AdvancedSection({
  backend,
  apiUrl,
  onBackendChange,
  onApiUrlChange,
}: {
  backend: string
  apiUrl: string
  onBackendChange: (backend: string) => void
  onApiUrlChange: (url: string) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="py-6 border-b border-border/60 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 cursor-pointer text-left mb-1"
      >
        <h3 className="text-[14px] font-semibold text-text">{t('market.advanced', 'Advanced')}</h3>
        <span className="text-[11px] text-text-muted/50">{expanded ? '\u25BC' : '\u25B6'}</span>
      </button>
      {!expanded && (
        <p className="text-[13px] text-text-muted/70">{t('market.dataBackendSelection', 'Data backend selection.')}</p>
      )}
      {expanded && (
        <div className="space-y-6 mt-4">
          {/* Data Backend */}
          <div>
            <p className="text-[13px] font-medium text-text mb-2">{t('market.dataBackend', 'Data Backend')}</p>
            <div className="flex border border-border rounded-lg overflow-hidden w-fit mb-2">
              {(['typebb-sdk', 'openbb-api'] as const).map((opt, i) => (
                <button
                  key={opt}
                  onClick={() => onBackendChange(opt)}
                  className={`px-4 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                    i > 0 ? 'border-l border-border' : ''
                  } ${
                    backend === opt
                      ? 'bg-bg-tertiary text-text'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  {opt === 'typebb-sdk' ? t('market.builtInEngine', 'Built-in Engine (TypeBB)') : t('market.externalOpenBB', 'External OpenBB API')}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-text-muted/70">
              {backend === 'typebb-sdk'
                ? t('market.builtInEngineDesc', 'Uses the built-in TypeBB engine. No external process required.')
                : t('market.externalOpenBBDesc', 'Connects to an external OpenBB-compatible HTTP endpoint.')}
            </p>
            {backend === 'openbb-api' && (
              <div className="mt-3">
                <Field label={t('market.apiUrl', 'API URL')}>
                  <input
                    className={inputClass}
                    value={apiUrl}
                    onChange={(e) => onApiUrlChange(e.target.value)}
                    placeholder="http://localhost:6900"
                  />
                </Field>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
