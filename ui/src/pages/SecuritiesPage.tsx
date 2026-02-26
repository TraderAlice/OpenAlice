import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { Toggle } from '../components/Toggle'
import { Section, Field, inputClass } from '../components/form'
import { GuardsSection, SECURITIES_GUARD_TYPES, type GuardEntry } from '../components/guards'
import { ReconnectButton } from '../components/ReconnectButton'
import type { AppConfig } from '../api'

interface SecuritiesConfig {
  allowedSymbols: string[]
  provider: {
    type: 'alpaca' | 'none'
    apiKey?: string
    secretKey?: string
    paper?: boolean
  }
  guards: GuardEntry[]
}

export function SecuritiesPage() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } =
    useConfigPage<SecuritiesConfig>({
      section: 'securities',
      extract: (full: AppConfig) => (full as Record<string, unknown>).securities as SecuritiesConfig,
    })

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
              onChange={updateConfig}
              onChangeImmediate={updateConfigImmediate}
            />
            <GuardsSection
              guards={config.guards || []}
              guardTypes={SECURITIES_GUARD_TYPES}
              description="Trading guards validate operations before they reach the broker. Guards run in order — first rejection stops the operation."
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

// ==================== Provider Section ====================

interface ProviderSectionProps {
  config: SecuritiesConfig
  onChange: (patch: Partial<SecuritiesConfig>) => void
  onChangeImmediate: (patch: Partial<SecuritiesConfig>) => void
}

function ProviderSection({ config, onChange, onChangeImmediate }: ProviderSectionProps) {
  const isAlpaca = config.provider.type === 'alpaca'

  const patchProvider = (field: string, value: unknown, immediate: boolean) => {
    const patch = {
      provider: { ...config.provider, type: 'alpaca' as const, [field]: value },
    }
    immediate ? onChangeImmediate(patch) : onChange(patch)
  }

  return (
    <Section
      title="Broker"
      description="Alpaca brokerage connection. Save your credentials, then click Reconnect to apply."
    >
      <Field label="API Key">
        <input
          className={inputClass}
          type="password"
          value={isAlpaca ? config.provider.apiKey || '' : ''}
          onChange={(e) => patchProvider('apiKey', e.target.value, false)}
          placeholder="Not configured"
        />
      </Field>
      <Field label="Secret Key">
        <input
          className={inputClass}
          type="password"
          value={isAlpaca ? config.provider.secretKey || '' : ''}
          onChange={(e) => patchProvider('secretKey', e.target.value, false)}
          placeholder="Not configured"
        />
      </Field>
      <label className="flex items-center gap-2.5 cursor-pointer mb-2">
        <Toggle
          checked={isAlpaca ? config.provider.paper ?? true : true}
          onChange={(v) => patchProvider('paper', v, true)}
        />
        <span className="text-[13px] text-text">Paper Trading</span>
      </label>
      <p className="text-[11px] text-text-muted/60">
        When enabled, orders are routed to Alpaca's paper trading environment. Disable for live trading.
      </p>
      <ReconnectButton variant="securities" />
    </Section>
  )
}
