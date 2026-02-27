import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { Toggle } from '../components/Toggle'
import { Section, Field, inputClass } from '../components/form'
import { GuardsSection, SECURITIES_GUARD_TYPES, type GuardEntry } from '../components/guards'
import { SDKSelector, SECURITIES_SDK_OPTIONS } from '../components/SDKSelector'
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

  const enabled = config?.provider.type !== 'none'

  const handleToggle = (on: boolean) => {
    if (on) {
      updateConfigImmediate({ provider: { ...config!.provider, type: 'alpaca' } })
    } else {
      updateConfigImmediate({ provider: { type: 'none' } })
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Securities Trading</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Broker connection and trading guard configuration for US equities.
            </p>
          </div>
          <SaveIndicator status={status} onRetry={retry} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            {/* Enable / SDK selection */}
            <Section title="Trading Interface">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[13px] text-text">Enable Securities Trading</p>
                  <p className="text-[11px] text-text-muted/60">
                    When disabled, the securities trading engine and all related tools are unloaded.
                  </p>
                </div>
                <Toggle checked={enabled} onChange={handleToggle} />
              </div>

              {enabled && (
                <div className="mt-1">
                  <p className="text-[12px] text-text-muted mb-3">Select a broker SDK to connect with your brokerage.</p>
                  <SDKSelector
                    options={SECURITIES_SDK_OPTIONS}
                    selected="alpaca"
                    onSelect={() => {/* future: switch SDK */}}
                  />
                </div>
              )}
            </Section>

            {/* Provider config — only when enabled */}
            {enabled && (
              <>
                <BrokerSection
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
              </>
            )}
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">Failed to load configuration.</p>}
      </div>
    </div>
  )
}

// ==================== Broker Section (Alpaca-specific) ====================

interface BrokerSectionProps {
  config: SecuritiesConfig
  onChange: (patch: Partial<SecuritiesConfig>) => void
  onChangeImmediate: (patch: Partial<SecuritiesConfig>) => void
}

function BrokerSection({ config, onChange, onChangeImmediate }: BrokerSectionProps) {
  const patchProvider = (field: string, value: unknown, immediate: boolean) => {
    const patch = {
      provider: { ...config.provider, type: 'alpaca' as const, [field]: value },
    }
    immediate ? onChangeImmediate(patch) : onChange(patch)
  }

  return (
    <Section
      title="Broker Connection"
      description="Alpaca brokerage credentials. Save your config, then click Reconnect to apply."
    >
      <Field label="API Key">
        <input
          className={inputClass}
          type="password"
          value={config.provider.apiKey || ''}
          onChange={(e) => patchProvider('apiKey', e.target.value, false)}
          placeholder="Not configured"
        />
      </Field>
      <Field label="Secret Key">
        <input
          className={inputClass}
          type="password"
          value={config.provider.secretKey || ''}
          onChange={(e) => patchProvider('secretKey', e.target.value, false)}
          placeholder="Not configured"
        />
      </Field>
      <label className="flex items-center gap-2.5 cursor-pointer mb-2">
        <Toggle
          checked={config.provider.paper ?? true}
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
