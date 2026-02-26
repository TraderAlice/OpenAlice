import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { Toggle } from '../components/Toggle'
import { Section, Field, inputClass } from '../components/form'
import { GuardsSection, CRYPTO_GUARD_TYPES, type GuardEntry } from '../components/guards'
import { ReconnectButton } from '../components/ReconnectButton'
import type { AppConfig } from '../api'

interface CryptoConfig {
  allowedSymbols: string[]
  provider: {
    type: 'ccxt' | 'none'
    exchange?: string
    apiKey?: string
    apiSecret?: string
    password?: string
    sandbox?: boolean
    demoTrading?: boolean
    defaultMarketType?: 'spot' | 'swap'
  }
  guards: GuardEntry[]
}

export function TradingPage() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } =
    useConfigPage<CryptoConfig>({
      section: 'crypto',
      extract: (full: AppConfig) => (full as Record<string, unknown>).crypto as CryptoConfig,
    })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Crypto Trading</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Exchange connection and trading guard configuration for cryptocurrency markets.
            </p>
          </div>
          <SaveIndicator status={status} onRetry={retry} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            <ExchangeSection
              config={config}
              onChange={updateConfig}
              onChangeImmediate={updateConfigImmediate}
            />
            <GuardsSection
              guards={config.guards || []}
              guardTypes={CRYPTO_GUARD_TYPES}
              description="Trading guards validate operations before they reach the exchange. Guards run in order — first rejection stops the operation."
              onChange={(guards) => updateConfig({ guards })}
              onChangeImmediate={(guards) => updateConfigImmediate({ guards })}
            />
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">Failed to load configuration.</p>}
      </div>
    </div>
  )
}

// ==================== Exchange Section ====================

interface ExchangeSectionProps {
  config: CryptoConfig
  onChange: (patch: Partial<CryptoConfig>) => void
  onChangeImmediate: (patch: Partial<CryptoConfig>) => void
}

function ExchangeSection({ config, onChange, onChangeImmediate }: ExchangeSectionProps) {
  const provider = config.provider
  const isCcxt = provider.type === 'ccxt'

  const patchProvider = (field: string, value: unknown, immediate: boolean) => {
    const patch = {
      provider: { ...provider, type: 'ccxt' as const, [field]: value },
    }
    immediate ? onChangeImmediate(patch) : onChange(patch)
  }

  return (
    <Section
      title="Exchange"
      description="CCXT exchange connection settings. Save your credentials, then click Reconnect to apply."
    >
      <Field label="Exchange">
        <input
          className={inputClass}
          value={isCcxt ? provider.exchange || '' : ''}
          onChange={(e) => patchProvider('exchange', e.target.value.trim(), false)}
          placeholder="bybit"
        />
      </Field>
      <Field label="API Key">
        <input
          className={inputClass}
          type="password"
          value={isCcxt ? provider.apiKey || '' : ''}
          onChange={(e) => patchProvider('apiKey', e.target.value, false)}
          placeholder="Not configured"
        />
      </Field>
      <Field label="API Secret">
        <input
          className={inputClass}
          type="password"
          value={isCcxt ? provider.apiSecret || '' : ''}
          onChange={(e) => patchProvider('apiSecret', e.target.value, false)}
          placeholder="Not configured"
        />
      </Field>
      <Field label="Password (optional)">
        <input
          className={inputClass}
          type="password"
          value={isCcxt ? provider.password || '' : ''}
          onChange={(e) => patchProvider('password', e.target.value, false)}
          placeholder="Required by some exchanges (e.g. OKX)"
        />
      </Field>
      <Field label="Market Type">
        <select
          className={inputClass}
          value={isCcxt ? provider.defaultMarketType || 'swap' : 'swap'}
          onChange={(e) => patchProvider('defaultMarketType', e.target.value, true)}
        >
          <option value="swap">Perpetual Swap</option>
          <option value="spot">Spot</option>
        </select>
      </Field>
      <div className="mb-3">
        <label className="flex items-center gap-2.5 cursor-pointer mb-2">
          <Toggle
            checked={isCcxt ? provider.sandbox ?? false : false}
            onChange={(v) => patchProvider('sandbox', v, true)}
          />
          <span className="text-[13px] text-text">Sandbox Mode</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer mb-2">
          <Toggle
            checked={isCcxt ? provider.demoTrading ?? true : true}
            onChange={(v) => patchProvider('demoTrading', v, true)}
          />
          <span className="text-[13px] text-text">Demo Trading</span>
        </label>
      </div>
      <ReconnectButton variant="crypto" />
    </Section>
  )
}
