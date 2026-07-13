import { useEffect, useMemo, useState, type ReactNode } from 'react'
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

import { configApi, type CredentialSummary } from '../api/config'
import { tradingApi, type TradingServiceStatus } from '../api/trading'
import type { AppConfig, UTAConfig } from '../api/types'
import type { AgentInfo } from '../components/workspace/api'
import { CenteredLoading } from '../components/StateViews'
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

const STATE_LABEL: Record<Readiness, string> = {
  ready: 'Ready',
  attention: 'Needs setup',
  optional: 'Optional',
  locked: 'Locked',
}

const STATE_STYLE: Record<Readiness, string> = {
  ready: 'border-green/25 bg-green/10 text-green',
  attention: 'border-red/25 bg-red/10 text-red',
  optional: 'border-border bg-bg-tertiary/60 text-text-muted',
  locked: 'border-border bg-bg-secondary text-text-muted',
}

export function OnboardingDesignPage() {
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
  }), [agents, runtime])

  const openTarget = (target?: ViewSpec) => {
    if (!target) return
    openOrFocus(target)
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-5 px-4 py-5 md:px-6">
        {loading ? (
          <CenteredLoading label="Loading setup state..." />
        ) : error ? (
          <div className="rounded-lg border border-red/30 bg-red/10 px-4 py-3 text-[13px] text-red">
            {error}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  Setup checklist
                </div>
                <h1 className="mt-1 text-[24px] font-semibold leading-tight text-text">
                  Bring Alice online one layer at a time.
                </h1>
                <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-text-muted">
                  Start with an agent runtime and AI access. Add UTA only when you want broker-aware analysis or trading workflows.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                <StatusChip>{model.tradingModeLabel}</StatusChip>
                <StatusChip>{model.installedAgentCount}/{model.agentCount} runtimes</StatusChip>
                <StatusChip>{model.utaCount} UTA</StatusChip>
              </div>
            </div>

            <StatusBand model={model} />

            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="min-w-0 rounded-lg border border-border bg-bg-secondary/50">
                <div className="border-b border-border px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-dim text-accent">
                      <TerminalSquare className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-[16px] font-semibold text-text">Setup path</h2>
                      <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                        The first incomplete item is the next useful action.
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
                <div className="rounded-lg border border-border bg-bg-secondary/50 px-4 py-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                    Shortcuts
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    <SmallAction
                      icon={<KeyRound className="h-3.5 w-3.5" />}
                      label="AI Provider"
                      onClick={() => openTarget({ kind: 'settings', params: { category: 'ai-provider' } })}
                    />
                    <SmallAction
                      icon={<Settings className="h-3.5 w-3.5" />}
                      label="Agent Permissions"
                      onClick={() => openTarget({ kind: 'settings', params: { category: 'agent-permissions' } })}
                    />
                    <SmallAction
                      icon={<WalletCards className="h-3.5 w-3.5" />}
                      label="Trading Settings"
                      onClick={() => openTarget({ kind: 'settings', params: { category: 'trading' } })}
                    />
                    <SmallAction
                      icon={<Bot className="h-3.5 w-3.5" />}
                      label="Ask Alice"
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
}) {
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
    title: hasAgentRuntime ? 'Agent runtime ready' : agentsKnown ? 'Choose an agent runtime' : 'Checking agent runtimes',
    body: hasAgentRuntime
      ? `${runtimeNames} can launch Alice workspaces.`
      : 'Desktop builds can include a managed runtime; developer installs can also use Codex, Claude Code, opencode, or Pi on PATH.',
    state: hasAgentRuntime ? 'ready' : 'attention',
    action: hasAgentRuntime ? 'Open Ask Alice' : 'Open runtime setup',
    target: hasAgentRuntime
      ? { kind: 'chat-landing', params: {} }
      : { kind: 'settings', params: { category: 'ai-provider' } },
    icon: TerminalSquare,
  }

  const credentialStep: StepModel = {
    id: 'ai-access',
    title: hasCredential ? 'AI access configured' : hasLoginRuntime ? 'CLI login can carry AI access' : 'Add AI access',
    body: hasCredential
      ? `${credentialCount} vault credential${credentialCount === 1 ? '' : 's'} available for workspace injection.`
      : hasLoginRuntime
        ? 'Claude Code and Codex can use their own login; vault credentials stay optional.'
        : 'Pi and opencode need a vault credential before they can call a model.',
    state: hasCredential || hasLoginRuntime ? 'ready' : 'attention',
    action: 'Open AI Provider',
    target: { kind: 'settings', params: { category: 'ai-provider' } },
    icon: KeyRound,
  }

  const modeStep: StepModel = {
    id: 'trading-mode',
    title: mode === 'lite' ? 'Lite mode active' : mode === 'readonly' ? 'Readonly mode active' : 'Pro mode active',
    body: mode === 'lite'
      ? 'UTA is disconnected. Alice can still analyze markets and research without broker state.'
      : mode === 'readonly'
        ? 'UTA can read accounts and positions. Broker writes stay blocked.'
        : 'UTA is enabled and per-account permissions decide write behavior.',
    state: 'ready',
    action: 'Choose mode',
    target: { kind: 'settings', params: { category: 'agent-permissions' } },
    icon: ShieldCheck,
  }

  const utaStep: StepModel = {
    id: 'uta-accounts',
    title: hasUTA ? 'UTA configured' : mode === 'lite' ? 'UTA can wait' : 'Connect a UTA',
    body: hasUTA
      ? `${utaCount} configured, ${enabledUtaCount} enabled, ${readOnlyUtaCount} read-only, ${vendorCount} data vendor${vendorCount === 1 ? '' : 's'}.`
      : mode === 'lite'
        ? 'Connect one later for portfolio-aware analysis, broker-backed data, or Trading as Git.'
        : 'Readonly and Pro modes need at least one broker or exchange account.',
    state: hasUTA ? 'ready' : mode === 'lite' ? 'optional' : 'attention',
    action: hasUTA ? 'Open Trading settings' : mode === 'lite' ? 'Add UTA later' : 'Add UTA',
    target: { kind: 'settings', params: { category: 'trading' } },
    icon: WalletCards,
  }

  const steps = [agentStep, credentialStep, modeStep, utaStep]

  const capabilities: CapabilityModel[] = [
    {
      id: 'ask-alice',
      label: 'Ask Alice',
      detail: hasAgentRuntime ? 'Workspace chat can launch.' : 'Needs one available agent runtime.',
      state: hasAgentRuntime ? 'ready' : 'attention',
      icon: Bot,
    },
    {
      id: 'market-analysis',
      label: 'Market analysis',
      detail: 'Available in Lite with OpenAlice market tools.',
      state: 'ready',
      icon: Compass,
    },
    {
      id: 'portfolio',
      label: 'Portfolio-aware analysis',
      detail: mode === 'lite' ? 'Locked until Readonly or Pro.' : hasUTA ? 'Broker accounts can be read.' : 'Needs a connected UTA.',
      state: mode === 'lite' ? 'locked' : hasUTA ? 'ready' : 'attention',
      icon: LineChart,
    },
    {
      id: 'trade-pr',
      label: 'Trading proposals',
      detail: mode === 'lite' ? 'Locked while UTA is disconnected.' : hasUTA ? 'Agents can stage broker proposals.' : 'Needs a connected UTA.',
      state: mode === 'lite' ? 'locked' : hasUTA ? 'ready' : 'attention',
      icon: GitBranch,
    },
    {
      id: 'auto-push',
      label: 'AI trade push',
      detail: mode === 'pro' && allowAiTrading ? 'Enabled globally.' : mode === 'pro' ? 'Manual approval remains required.' : 'Only relevant in Pro.',
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
    tradingModeLabel: `${mode[0].toUpperCase()}${mode.slice(1)} · ${modeSource}`,
    mode,
    modeSource,
    hasUTA,
    utaCount,
    allowAiTrading,
  }
}

function StatusBand({ model }: { model: ReturnType<typeof buildOnboardingModel> }) {
  return (
    <div className="border-y border-border bg-bg-secondary/35">
      <div className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0">
        <StatusMetric label="Setup" value={`${model.readyCount}/${model.steps.length}`} sub="ready checks" />
        <StatusMetric label="Mode" value={model.tradingModeLabel} sub="global trading capability" />
        <StatusMetric label="Agent" value={`${model.installedAgentCount}/${model.agentCount}`} sub="available runtimes" />
        <StatusMetric label="UTA" value={model.hasUTA ? `${model.utaCount} configured` : 'none'} sub="broker connection state" />
      </div>
    </div>
  )
}

function StatusMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 px-3 py-3">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 truncate text-[14px] font-semibold text-text">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-text-muted">{sub}</div>
    </div>
  )
}

function CapabilityPanel({ model }: { model: ReturnType<typeof buildOnboardingModel> }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-bg-secondary/50">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-dim text-accent">
            <Compass className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-text">Capability map</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
              Shows what is usable in the current mode.
            </p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-border px-4">
        {model.capabilities.map((capability) => {
          const Icon = capability.icon
          return (
            <div key={capability.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-tertiary text-text-muted">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text">{capability.label}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-text-muted">{capability.detail}</div>
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
    <div className="min-w-0 border-b border-border/70 py-4 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-[12px] font-semibold text-text-muted">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <div className="min-w-0 text-[14px] font-semibold text-text">{step.title}</div>
            <StateBadge state={step.state} />
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{step.body}</p>
        </div>
        <button
          type="button"
          onClick={() => onAction(step.target)}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-text-muted transition-colors hover:border-accent/50 hover:text-accent"
          aria-label={step.action}
          title={step.action}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
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
    <button
      type="button"
      onClick={() => onAction(step.target)}
      className="flex w-full items-center justify-between gap-3 rounded-lg bg-accent px-3 py-2.5 text-left text-white transition-colors hover:bg-accent/90"
    >
      <span className="min-w-0 truncate text-[13px] font-semibold">{step.action}</span>
      <ArrowRight className="h-4 w-4 shrink-0" />
    </button>
  )
}

function SmallAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-[12px] font-medium text-text-muted transition-colors hover:border-accent/50 hover:text-accent"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function StateBadge({ state, label }: { state: Readiness; label?: string }) {
  return (
    <span className={`inline-flex min-h-5 items-center rounded-full border px-2 text-[10px] font-medium ${STATE_STYLE[state]}`}>
      {label ?? STATE_LABEL[state]}
    </span>
  )
}

function StateDot({ state }: { state: Readiness }) {
  const Icon = state === 'ready'
    ? CheckCircle2
    : state === 'attention'
      ? AlertTriangle
      : state === 'locked'
        ? XCircle
        : Circle
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${STATE_STYLE[state]}`} title={STATE_LABEL[state]}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  )
}

function StatusChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-bg-secondary px-2 py-1">
      {children}
    </span>
  )
}
