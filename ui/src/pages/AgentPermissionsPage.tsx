import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { CircleAlert, Gauge, LockKeyhole, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api, type AppConfig } from '../api'
import type { TradingMode } from '../api/types'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, RecoverySurface } from '../components/StateViews'
import { Toggle } from '../components/Toggle'
import { SelectionCheckIcon } from '../components/ui/selection-check-icon'
import { StatusIndicator } from '../components/motion/StatusIndicator'
import { ConfigSection, SettingsScrollArea } from '../components/form'
import { ensureTradingModePolling, useTradingMode } from '../live/trading-mode'

const MODE_META: Record<TradingMode, {
  Icon: LucideIcon
  labelKey: 'settings.agentPermissions.mode.lite.label' | 'settings.agentPermissions.mode.readonly.label' | 'settings.agentPermissions.mode.pro.label'
  descriptionKey: 'settings.agentPermissions.mode.lite.description' | 'settings.agentPermissions.mode.readonly.description' | 'settings.agentPermissions.mode.pro.description'
}> = {
  lite: {
    Icon: Gauge,
    labelKey: 'settings.agentPermissions.mode.lite.label',
    descriptionKey: 'settings.agentPermissions.mode.lite.description',
  },
  readonly: {
    Icon: LockKeyhole,
    labelKey: 'settings.agentPermissions.mode.readonly.label',
    descriptionKey: 'settings.agentPermissions.mode.readonly.description',
  },
  pro: {
    Icon: ShieldCheck,
    labelKey: 'settings.agentPermissions.mode.pro.label',
    descriptionKey: 'settings.agentPermissions.mode.pro.description',
  },
}

const MODES: TradingMode[] = ['lite', 'readonly', 'pro']

export function AgentPermissionsPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loadError, setLoadError] = useState(false)

  const loadConfig = useCallback(async () => {
    setConfig(null)
    setLoadError(false)
    try {
      setConfig(await api.config.load())
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    ensureTradingModePolling()
    void loadConfig()
  }, [loadConfig])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('settings.agentPermissions.title')} />
      {!config ? (
        loadError ? <PermissionsLoadError onRetry={() => void loadConfig()} /> : <PageLoading />
      ) : (
        <SettingsScrollArea>
          <div className="mx-auto w-full max-w-[980px] px-4 md:px-6">
            <TradingModeSection />
            <ConfigSection
              title={t('settings.agentPermissions.aiPush.title')}
              description={t('settings.agentPermissions.aiPush.description')}
            >
              <AiTradingToggle config={config} setConfig={setConfig} />
            </ConfigSection>
          </div>
        </SettingsScrollArea>
      )}
    </div>
  )
}

function PermissionsLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()

  return (
    <RecoverySurface
      title={t('settings.agentPermissions.loadErrorTitle')}
      description={t('settings.agentPermissions.loadErrorDescription')}
      actionLabel={t('common.retry')}
      onAction={onRetry}
      icon={<CircleAlert className="size-6" strokeWidth={1.7} aria-hidden />}
    />
  )
}

function TradingModeSection() {
  const { t } = useTranslation()
  const status = useTradingMode((s) => s.status)
  const loading = useTradingMode((s) => s.loading)
  const saving = useTradingMode((s) => s.saving)
  const error = useTradingMode((s) => s.error)
  const setMode = useTradingMode((s) => s.setMode)

  return (
    <ConfigSection
      title={t('settings.agentPermissions.mode.title')}
      description={t('settings.agentPermissions.mode.description')}
    >
      <div className="grid gap-2 xl:grid-cols-3">
        {MODES.map((mode) => {
          const meta = MODE_META[mode]
          const active = status.mode === mode
          const disabled = loading || status.envLocked || saving !== null
          return (
            <Button
              key={mode}
              variant="ghost"
              focusableWhenDisabled
              type="button"
              aria-pressed={active}
              disabled={disabled}
              aria-busy={saving === mode}
              onClick={() => {
                if (mode === status.mode) return
                void setMode(mode).catch(() => {})
              }}
              className={`flex h-auto min-h-[100px] items-start justify-start gap-3 whitespace-normal font-normal rounded-lg border px-3.5 py-3 text-left transition-[border-color,background-color] duration-[var(--motion-fast)] ${
                active
                  ? 'border-foreground/25 bg-muted/50 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted hover:text-foreground'
              } ${disabled ? 'cursor-default opacity-70' : ''}`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground">
                <meta.Icon size={16} strokeWidth={1.8} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t(meta.labelKey)}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{t(meta.descriptionKey)}</span>
              </span>
              <span className="mt-1 grid size-4 shrink-0 place-items-center">
                {saving === mode ? <StatusIndicator size={16} /> : active ? <SelectionCheckIcon /> : null}
              </span>
            </Button>
          )
        })}
      </div>
      <div className="mt-3 text-sm leading-relaxed text-muted-foreground/70">
        {status.envLocked
          ? t('settings.agentPermissions.mode.envLocked')
          : t('settings.agentPermissions.mode.source', { source: status.modeSource })}
      </div>
      {error && (
        <div role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive leading-relaxed">
          {error}
        </div>
      )}
    </ConfigSection>
  )
}

/**
 * Master switch for AI-initiated trade execution (issue #95). OFF by default;
 * enabling it requires a deliberate danger-confirm (turning it OFF is
 * immediate). While ON, a persistent red banner keeps the risk visible.
 */
function AiTradingToggle({
  config,
  setConfig,
}: {
  config: AppConfig
  setConfig: Dispatch<SetStateAction<AppConfig | null>>
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const savingRef = useRef(false)
  const mode = useTradingMode((s) => s.status.mode)
  const enabled = config.agent?.allowAiTrading || false

  const persist = useCallback(async (enabled: boolean) => {
    if (savingRef.current) return false
    savingRef.current = true
    setPending(true)
    setSaveError(false)
    try {
      await api.config.updateSection('agent', { ...config.agent, allowAiTrading: enabled })
      setConfig((current) => current ? { ...current, agent: { ...current.agent, allowAiTrading: enabled } } : current)
      return true
    } catch {
      setSaveError(true)
      return false
    } finally {
      savingRef.current = false
      setPending(false)
    }
  }, [config.agent, setConfig])

  const onToggle = (v: boolean) => {
    if (v) {
      setConfirming(true)
    } else {
      void persist(false)
    }
  }

  return (
    <>
      <div className="flex min-h-12 items-center justify-between gap-4 py-1">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-foreground">{t('settings.agent.allowAiTrading')}</span>
          <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
            {enabled ? t('settings.agent.allowAiTradingOn') : t('settings.agent.allowAiTradingOff')}
          </p>
        </div>
        <Toggle
          ariaLabel={t('settings.agent.allowAiTrading')}
          checked={enabled}
          pending={pending}
          onChange={onToggle}
        />
      </div>
      {saveError && !confirming && <p role="alert" className="mt-2 text-sm text-destructive">{t('common.saveFailed')}</p>}
      {enabled && (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive leading-relaxed">
          {t('settings.agent.allowAiTradingWarning')}
        </div>
      )}
      {enabled && mode !== 'pro' && (
        <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-muted-foreground leading-relaxed">
          {t('settings.agentPermissions.aiPush.proOnly')}
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('settings.agent.allowAiTradingConfirmTitle')}
          message={<><p>{t('settings.agent.allowAiTradingConfirmBody')}</p>{saveError && <p role="alert" className="mt-3 text-destructive">{t('common.saveFailed')}</p>}</>}
          confirmLabel={t('settings.agent.allowAiTradingConfirmCta')}
          variant="danger"
          onConfirm={async () => {
            if (await persist(true)) setConfirming(false)
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}
