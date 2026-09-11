import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  Compass,
  GitBranch,
  KeyRound,
  LineChart,
  Lock,
  Settings,
  ShieldCheck,
  TerminalSquare,
  WalletCards,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { configApi, type CredentialSummary } from '../api/config'
import { tradingApi, type TradingServiceStatus } from '../api/trading'
import type { AppConfig, UTAConfig } from '../api/types'
import type { AgentInfo } from '../components/workspace/api'
import { CenteredLoading } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

type Readiness = 'ready' | 'attention' | 'optional' | 'locked'

interface OnboardingRuntimeState {
  credentials: CredentialSummary[]
  tradingStatus: TradingServiceStatus | null
  utas: UTAConfig[]
  appConfig: AppConfig | null
}

interface StepModel {
  id: string
  title: string
  body: string
  state: Readiness
  action: string
  target?: ViewSpec
  icon: LucideIcon
}

interface CapabilityModel {
  id: string
  label: string
  detail: string
  state: Readiness
  icon: LucideIcon
}

const INITIAL_STATE: OnboardingRuntimeState = {
  credentials: [],
  tradingStatus: null,
  utas: [],
  appConfig: null,
}

const STATE_STYLE: Record<Readiness, string> = {
  ready: 'text-success',
  attention: 'text-destructive',
  optional: 'text-muted-foreground',
  locked: 'text-muted-foreground',
}
const STATE_ICON: Record<Readiness, LucideIcon> = {
  ready: CheckCircle2,
  attention: AlertTriangle,
  optional: Circle,
  locked: XCircle,
}

export function OnboardingDesignPage() {
  const { t } = useTranslation()
  const { agents } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const [runtime, setRuntime] = useState<OnboardingRuntimeState>(INITIAL_STATE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    Promise.all([
      configApi.getCredentials(),
      tradingApi.status(),
      tradingApi.loadTradingConfig(),
      configApi.load(),
    ])
      .then(([credentials, tradingStatus, tradingConfig, appConfig]) => {
        if (!live) return
        setRuntime({
          credentials: credentials.credentials,
          tradingStatus,
          utas: tradingConfig.utas,
          appConfig,
        })
      })
      .catch((err) => {
        if (!live) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [])

  const model = useMemo(() => buildOnboardingModel({
    agents,
    credentials: runtime.credentials,
    tradingStatus: runtime.tradingStatus,
    utas: runtime.utas,
    appConfig: runtime.appConfig,
  }, t), [agents, runtime, t])

  const openTarget = (target?: ViewSpec) => {
    if (!target) return
    openOrFocus(target)
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-5 px-4 py-5 md:px-6">
        {loading ? (
          <CenteredLoading label={t('onboardingChecklist.loading')} />
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] leading-5 text-destructive">
            {error}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h1 className="text-[24px] font-semibold leading-tight text-foreground">
                  {t('onboardingChecklist.title')}
                </h1>
                <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-muted-foreground">
                  {t('onboardingChecklist.body')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] leading-[15px] text-muted-foreground">
                <StatusChip>{model.tradingModeLabel}</StatusChip>
                <StatusChip>{t('onboardingChecklist.summary.runtimes', {
                  installed: model.installedAgentCount,
                  total: model.agentCount,
                })}</StatusChip>
                <StatusChip>{t('onboardingChecklist.summary.uta', { count: model.utaCount })}</StatusChip>
              </div>
            </div>

            <StatusBand model={model} />

            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="min-w-0 rounded-lg border border-border bg-secondary/50">
                <div className="border-b border-border px-4 py-3">
                  <div className="flex items-start gap-3">
                    <TerminalSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <h2 className="text-[16px] font-semibold text-foreground">
                        {t('onboardingChecklist.path.title')}
                      </h2>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                        {t('onboardingChecklist.path.body')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-2">
                  {model.steps.map((step, index) => (
                    <StepRow
                      key={step.id}
                      step={step}
                      index={index + 1}
                      onAction={openTarget}
                    />
                  ))}
                </div>
                <div className="border-t border-border px-4 py-4">
                  <PrimaryAction step={model.primaryStep} onAction={openTarget} />
                </div>
              </section>

              <aside className="min-w-0 space-y-5">
                <CapabilityPanel model={model} />
                <div className="rounded-lg border border-border bg-secondary/50 px-4 py-4">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {t('onboardingChecklist.shortcuts.title')}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    <SmallAction
                      icon={<KeyRound className="h-3.5 w-3.5" />}
                      label={t('onboardingChecklist.shortcuts.aiProvider')}
                      onClick={() => openTarget({ kind: 'settings', params: { category: 'ai-provider' } })}
                    />
                    <SmallAction
                      icon={<Settings className="h-3.5 w-3.5" />}
                      label={t('onboardingChecklist.shortcuts.agentPermissions')}
                      onClick={() => openTarget({ kind: 'settings', params: { category: 'agent-permissions' } })}
                    />
                    <SmallAction
                      icon={<WalletCards className="h-3.5 w-3.5" />}
                      label={t('onboardingChecklist.shortcuts.tradingSettings')}
                      onClick={() => openTarget({ kind: 'settings', params: { category: 'trading' } })}
                    />
                    <SmallAction
                      icon={<Bot className="h-3.5 w-3.5" />}
                      label={t('onboardingChecklist.shortcuts.askAlice')}
                      onClick={() => openTarget({ kind: 'chat-landing', params: {} })}
                    />
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function buildOnboardingModel(input: {
  agents: readonly Pick<AgentInfo, 'id' | 'displayName' | 'kind' | 'installed'>[]
  credentials: CredentialSummary[]
  tradingStatus: TradingServiceStatus | null
  utas: UTAConfig[]
  appConfig: AppConfig | null
}, t: TFunction) {
  const agentRuntimes = input.agents.filter((a) => a.kind !== 'utility')
  const installedAgents = agentRuntimes.filter((a) => a.installed !== false)
  const agentCount = agentRuntimes.length
  const installedAgentCount = installedAgents.length
  const agentsKnown = agentCount > 0
  const hasAgentRuntime = agentsKnown && installedAgentCount > 0
  const credentialCount = input.credentials.length
  const hasCredential = credentialCount > 0
  const hasLoginRuntime = installedAgents.some((a) => a.id === 'claude' || a.id === 'codex')
  const mode = input.tradingStatus?.mode ?? input.appConfig?.trading?.mode ?? 'lite'
  const modeSource = input.tradingStatus?.modeSource ?? 'auto'
  const utaCount = input.utas.length
  const enabledUtaCount = input.utas.filter((u) => u.enabled).length
  const readOnlyUtaCount = input.utas.filter((u) => u.readOnly).length
  const vendorCount = input.utas.filter((u) => u.asVendor).length
  const hasUTA = utaCount > 0
  const allowAiTrading = input.appConfig?.agent?.allowAiTrading === true

  const runtimeNames = installedAgents.map((a) => a.displayName).join(', ')
  const agentStep: StepModel = {
    id: 'agent-runtime',
    title: hasAgentRuntime
      ? t('onboardingChecklist.steps.agent.readyTitle')
      : agentsKnown
        ? t('onboardingChecklist.steps.agent.chooseTitle')
        : t('onboardingChecklist.steps.agent.checkingTitle'),
    body: hasAgentRuntime
      ? t('onboardingChecklist.steps.agent.readyBody', { runtimes: runtimeNames })
      : t('onboardingChecklist.steps.agent.missingBody'),
    state: hasAgentRuntime ? 'ready' : 'attention',
    action: hasAgentRuntime
      ? t('onboardingChecklist.steps.agent.openAlice')
      : t('onboardingChecklist.steps.agent.openSetup'),
    target: hasAgentRuntime
      ? { kind: 'chat-landing', params: {} }
      : { kind: 'settings', params: { category: 'ai-provider' } },
    icon: TerminalSquare,
  }

  const credentialStep: StepModel = {
    id: 'ai-access',
    title: hasCredential
      ? t('onboardingChecklist.steps.ai.configuredTitle')
      : hasLoginRuntime
        ? t('onboardingChecklist.steps.ai.cliTitle')
        : t('onboardingChecklist.steps.ai.addTitle'),
    body: hasCredential
      ? t('onboardingChecklist.steps.ai.configuredBody', { count: credentialCount })
      : hasLoginRuntime
        ? t('onboardingChecklist.steps.ai.cliBody')
        : t('onboardingChecklist.steps.ai.addBody'),
    state: hasCredential || hasLoginRuntime ? 'ready' : 'attention',
    action: t('onboardingChecklist.steps.ai.action'),
    target: { kind: 'settings', params: { category: 'ai-provider' } },
    icon: KeyRound,
  }

  const modeStep: StepModel = {
    id: 'trading-mode',
    title: t('onboardingChecklist.steps.mode.activeTitle', {
      mode: t(`firstRunGuide.mode.${mode}`),
    }),
    body: mode === 'lite'
      ? t('onboardingChecklist.steps.mode.liteBody')
      : mode === 'readonly'
        ? t('onboardingChecklist.steps.mode.readonlyBody')
        : t('onboardingChecklist.steps.mode.proBody'),
    state: 'ready',
    action: t('onboardingChecklist.steps.mode.action'),
    target: { kind: 'settings', params: { category: 'agent-permissions' } },
    icon: ShieldCheck,
  }

  const utaStep: StepModel = {
    id: 'uta-accounts',
    title: hasUTA
      ? t('onboardingChecklist.steps.uta.configuredTitle')
      : mode === 'lite'
        ? t('onboardingChecklist.steps.uta.waitTitle')
        : t('onboardingChecklist.steps.uta.connectTitle'),
    body: hasUTA
      ? t('onboardingChecklist.steps.uta.configuredBody', {
        total: utaCount,
        enabled: enabledUtaCount,
        readOnly: readOnlyUtaCount,
        vendors: vendorCount,
      })
      : mode === 'lite'
        ? t('onboardingChecklist.steps.uta.waitBody')
        : t('onboardingChecklist.steps.uta.connectBody'),
    state: hasUTA ? 'ready' : mode === 'lite' ? 'optional' : 'attention',
    action: hasUTA
      ? t('onboardingChecklist.steps.uta.openSettings')
      : mode === 'lite'
        ? t('onboardingChecklist.steps.uta.addLater')
        : t('onboardingChecklist.steps.uta.add'),
    target: { kind: 'settings', params: { category: 'trading' } },
    icon: WalletCards,
  }

  const steps = [agentStep, credentialStep, modeStep, utaStep]

  const capabilities: CapabilityModel[] = [
    {
      id: 'ask-alice',
      label: t('onboardingChecklist.capabilities.askAlice.label'),
      detail: hasAgentRuntime
        ? t('onboardingChecklist.capabilities.askAlice.ready')
        : t('onboardingChecklist.capabilities.askAlice.blocked'),
      state: hasAgentRuntime ? 'ready' : 'attention',
      icon: Bot,
    },
    {
      id: 'market-analysis',
      label: t('onboardingChecklist.capabilities.market.label'),
      detail: t('onboardingChecklist.capabilities.market.detail'),
      state: 'ready',
      icon: Compass,
    },
    {
      id: 'portfolio',
      label: t('onboardingChecklist.capabilities.portfolio.label'),
      detail: mode === 'lite'
        ? t('onboardingChecklist.capabilities.portfolio.lite')
        : hasUTA
          ? t('onboardingChecklist.capabilities.portfolio.ready')
          : t('onboardingChecklist.capabilities.portfolio.needsUta'),
      state: mode === 'lite' ? 'locked' : hasUTA ? 'ready' : 'attention',
      icon: LineChart,
    },
    {
      id: 'trade-pr',
      label: t('onboardingChecklist.capabilities.proposals.label'),
      detail: mode === 'lite'
        ? t('onboardingChecklist.capabilities.proposals.lite')
        : hasUTA
          ? t('onboardingChecklist.capabilities.proposals.ready')
          : t('onboardingChecklist.capabilities.proposals.needsUta'),
      state: mode === 'lite' ? 'locked' : hasUTA ? 'ready' : 'attention',
      icon: GitBranch,
    },
    {
      id: 'auto-push',
      label: t('onboardingChecklist.capabilities.aiPush.label'),
      detail: mode === 'pro' && allowAiTrading
        ? t('onboardingChecklist.capabilities.aiPush.enabled')
        : mode === 'pro'
          ? t('onboardingChecklist.capabilities.aiPush.manual')
          : t('onboardingChecklist.capabilities.aiPush.proOnly'),
      state: mode === 'pro' && allowAiTrading ? 'ready' : mode === 'pro' ? 'optional' : 'locked',
      icon: Lock,
    },
  ]

  const primaryStep = steps.find((s) => s.state === 'attention') ?? steps.find((s) => s.state === 'optional') ?? steps[0]
  const readyCount = steps.filter((s) => s.state === 'ready').length

  return {
    steps,
    capabilities,
    primaryStep,
    readyCount,
    agentCount,
    installedAgentCount,
    credentialCount,
    tradingModeLabel: t('onboardingChecklist.summary.mode', {
      mode: t(`firstRunGuide.mode.${mode}`),
      source: t(`onboardingChecklist.source.${modeSource}`),
    }),
    mode,
    modeSource,
    hasUTA,
    utaCount,
    allowAiTrading,
  }
}

function StatusBand({ model }: { model: ReturnType<typeof buildOnboardingModel> }) {
  const { t } = useTranslation()
  return (
    <div className="border-y border-border bg-secondary/35">
      <div className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0">
        <StatusMetric
          label={t('onboardingChecklist.status.setup')}
          value={`${model.readyCount}/${model.steps.length}`}
          sub={t('onboardingChecklist.status.readyChecks')}
        />
        <StatusMetric
          label={t('onboardingChecklist.status.mode')}
          value={model.tradingModeLabel}
          sub={t('onboardingChecklist.status.tradingCapability')}
        />
        <StatusMetric
          label={t('onboardingChecklist.status.agent')}
          value={`${model.installedAgentCount}/${model.agentCount}`}
          sub={t('onboardingChecklist.status.availableRuntimes')}
        />
        <StatusMetric
          label="UTA"
          value={model.hasUTA
            ? t('onboardingChecklist.status.configuredUta', { count: model.utaCount })
            : t('onboardingChecklist.status.none')}
          sub={t('onboardingChecklist.status.brokerState')}
        />
      </div>
    </div>
  )
}

function StatusMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 px-3 py-3">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-[14px] font-semibold text-foreground">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>
    </div>
  )
}

function CapabilityPanel({ model }: { model: ReturnType<typeof buildOnboardingModel> }) {
  const { t } = useTranslation()
  return (
    <section className="min-w-0 rounded-lg border border-border bg-secondary/50">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <Compass className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-foreground">
              {t('onboardingChecklist.capabilities.title')}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {t('onboardingChecklist.capabilities.body')}
            </p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-border px-4">
        {model.capabilities.map((capability) => {
          const Icon = capability.icon
          return (
            <div key={capability.id} className="grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-foreground">{capability.label}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{capability.detail}</div>
              </div>
              <StateDot state={capability.state} />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function StepRow({
  step,
  index,
  onAction,
}: {
  step: StepModel
  index: number
  onAction: (target?: ViewSpec) => void
}) {
  const Icon = step.icon
  return (
    <div className="min-h-12 min-w-0 border-b border-border/70 py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 w-5 shrink-0 text-center text-[12px] leading-[18px] font-semibold tabular-nums text-muted-foreground">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 text-[14px] font-semibold text-foreground">{step.title}</div>
            <StateBadge state={step.state} />
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{step.body}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onAction(step.target)}
          className="mt-0.5 text-muted-foreground hover:text-primary"
          aria-label={step.action}
          title={step.action}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function PrimaryAction({
  step,
  onAction,
}: {
  step?: StepModel
  onAction: (target?: ViewSpec) => void
}) {
  if (!step) return null
  return (
    <Button
      type="button"
      onClick={() => onAction(step.target)}
      className="w-full justify-between text-left"
    >
      <span className="min-w-0 truncate text-[13px] font-semibold">{step.action}</span>
      <ArrowRight className="h-4 w-4 shrink-0" />
    </Button>
  )
}

function SmallAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="min-w-0 text-[12px] text-muted-foreground hover:text-primary"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Button>
  )
}

function StateBadge({ state, label }: { state: Readiness; label?: string }) {
  const { t } = useTranslation()
  const Icon = STATE_ICON[state]
  return (
    <span className={`inline-flex min-h-5 items-center gap-1.5 text-[10px] leading-[14px] font-medium ${STATE_STYLE[state]}`}>
      <Icon className="size-3" aria-hidden />
      {label ?? t(`onboardingChecklist.state.${state}`)}
    </span>
  )
}

function StateDot({ state }: { state: Readiness }) {
  const { t } = useTranslation()
  const Icon = STATE_ICON[state]
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground"
      title={t(`onboardingChecklist.state.${state}`)}
    >
      <Icon className={`h-3.5 w-3.5 ${state === 'ready' ? 'text-success' : state === 'attention' ? 'text-destructive' : ''}`} />
    </span>
  )
}

function StatusChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-8 items-center text-[11px] leading-[15px] text-muted-foreground">
      {children}
    </span>
  )
}
