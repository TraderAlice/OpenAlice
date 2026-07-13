import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Gauge, LockKeyhole, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api, type AppConfig } from '../api'
import type { TradingMode } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'
import { Toggle } from '../components/Toggle'
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

  useEffect(() => {
    ensureTradingModePolling()
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  if (!config) return <PageLoading />

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('settings.agentPermissions.title')} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[980px] px-4 md:px-6">
          <TradingModeSection />
          <PermissionSection
            title={t('settings.agentPermissions.aiPush.title')}
            description={t('settings.agentPermissions.aiPush.description')}
          >
            <AiTradingToggle config={config} setConfig={setConfig} />
          </PermissionSection>
        </div>
      </div>
    </div>
  )
}

function PermissionSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 border-b border-border/60 py-6 last:border-b-0 xl:grid-cols-[260px_minmax(0,1fr)] xl:gap-10">
      <div className="min-w-0 xl:pt-0.5">
        <h3 className="text-[14px] font-semibold text-text">{title}</h3>
        {description && (
          <p className="mt-1.5 max-w-[42rem] text-[13px] leading-relaxed text-text-muted/70">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
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
    <PermissionSection
      title={t('settings.agentPermissions.mode.title')}
      description={t('settings.agentPermissions.mode.description')}
    >
      <div className="grid gap-2">
        {MODES.map((mode) => {
          const meta = MODE_META[mode]
          const active = status.mode === mode
          const disabled = loading || status.envLocked || saving !== null
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => {
                if (mode === status.mode) return
                void setMode(mode).catch(() => {})
              }}
              className={`flex min-h-[82px] items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-[border-color,background-color] ${
                active
                  ? 'border-accent/50 bg-accent/10 text-text'
                  : 'border-border bg-bg text-text-muted hover:border-accent/40 hover:bg-bg-tertiary hover:text-text'
              } ${disabled ? 'cursor-default opacity-70' : ''}`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${active ? 'bg-accent/15 text-accent' : 'bg-bg-tertiary text-text-muted'}`}>
                <meta.Icon size={16} strokeWidth={1.8} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{t(meta.labelKey)}</span>
                <span className="mt-1 block text-[12px] leading-relaxed text-text-muted">{t(meta.descriptionKey)}</span>
                {saving === mode && (
                  <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" aria-hidden />
                    {t('settings.agentPermissions.mode.saving')}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-3 text-[11px] leading-relaxed text-text-muted/70">
        {status.envLocked
          ? t('settings.agentPermissions.mode.envLocked')
          : t('settings.agentPermissions.mode.source', { source: status.modeSource })}
      </div>
      {error && (
        <div className="mt-2 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red leading-relaxed">
          {error}
        </div>
      )}
    </PermissionSection>
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
  const mode = useTradingMode((s) => s.status.mode)
  const enabled = config.agent?.allowAiTrading || false

  const persist = useCallback(async (v: boolean) => {
    await api.config.updateSection('agent', { ...config.agent, allowAiTrading: v })
    setConfig((c) => (c ? { ...c, agent: { ...c.agent, allowAiTrading: v } } : c))
  }, [config.agent, setConfig])

  const onToggle = (v: boolean) => {
    if (v) {
      setConfirming(true)
    } else {
      void persist(false).catch(() => { /* toggle stays on if the write fails */ })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-text">{t('settings.agent.allowAiTrading')}</span>
          <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
            {enabled ? t('settings.agent.allowAiTradingOn') : t('settings.agent.allowAiTradingOff')}
          </p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} />
      </div>
      {enabled && (
        <div className="mt-2 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red leading-relaxed">
          {t('settings.agent.allowAiTradingWarning')}
        </div>
      )}
      {enabled && mode !== 'pro' && (
        <div className="mt-2 rounded-md border border-yellow-400/30 bg-yellow-400/5 px-3 py-2 text-[12px] text-text-muted leading-relaxed">
          {t('settings.agentPermissions.aiPush.proOnly')}
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('settings.agent.allowAiTradingConfirmTitle')}
          message={t('settings.agent.allowAiTradingConfirmBody')}
          confirmLabel={t('settings.agent.allowAiTradingConfirmCta')}
          variant="danger"
          onConfirm={async () => {
            try { await persist(true) } catch { /* stays off — write failed */ }
            setConfirming(false)
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}
