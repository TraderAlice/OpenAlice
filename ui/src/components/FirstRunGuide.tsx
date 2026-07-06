import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  Compass,
  GitBranch,
  KeyRound,
  Lock,
  MousePointerClick,
  ShieldCheck,
  TerminalSquare,
  WalletCards,
  X,
} from 'lucide-react'

import { configApi, type CredentialSummary } from '../api/config'
import { tradingApi, type TradingServiceStatus } from '../api/trading'
import type { BrokerPreset, Preset, TradingMode, UTAConfig } from '../api/types'
import { CreateUTADialog } from './uta/CreateUTADialog'
import { CredentialModal } from './credentials/CredentialModal'
import {
  FIRST_RUN_STEP_KEYS,
  buildFirstRunGuideAccess,
  buildFirstRunGuideModel,
  parseFirstRunStepOverride,
} from './first-run-guide-model'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useTradingMode } from '../live/trading-mode'
import { useWorkspace } from '../tabs/store'
import { isApiKeyPreset } from '../lib/presetHelpers'

const BASE_DISMISS_KEY = 'openalice.onboarding.firstRunGuide.dismissed.v3'
const STORAGE_SUFFIX = import.meta.env.VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX?.trim()
const DISMISS_KEY = STORAGE_SUFFIX ? `${BASE_DISMISS_KEY}.${STORAGE_SUFFIX}` : BASE_DISMISS_KEY
const ONBOARDING_TEST_MODE = import.meta.env.VITE_OPENALICE_ONBOARDING_TEST === '1'
const MOCK_CREDENTIAL_TEST = import.meta.env.VITE_OPENALICE_CREDENTIAL_TEST_MODE === 'mock'
const ONBOARDING_TEST_PRESET_ID = 'openalice-onboarding-test'
const ONBOARDING_TEST_API_KEY = 'oa_test_ok'

const ONBOARDING_TEST_PRESET: Preset = {
  id: ONBOARDING_TEST_PRESET_ID,
  label: 'OpenAlice Test Provider',
  description: 'Local mock for onboarding test mode',
  category: 'custom',
  defaultName: 'OpenAlice Test Provider',
  hint: 'Development-only. This provider exists only in onboarding test mode and never calls an external AI service.',
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string', title: 'API key' },
      model: {
        type: 'string',
        title: 'Model',
        oneOf: [{ const: 'openalice-onboarding-test', title: 'Onboarding Mock' }],
      },
    },
    required: ['apiKey', 'model'],
  },
  regions: [
    {
      id: 'local-mock',
      label: 'Local mock',
      wires: { 'openai-chat': 'https://onboarding.openalice.test/openai-chat' },
    },
  ],
}

interface GuideState {
  credentials: CredentialSummary[]
  tradingStatus: TradingServiceStatus | null
  utas: UTAConfig[]
}

type StepDirection = 'forward' | 'back'
type RowTone = 'ready' | 'attention' | 'muted'

const INITIAL_GUIDE_STATE: GuideState = {
  credentials: [],
  tradingStatus: null,
  utas: [],
}

async function fetchGuideState(): Promise<GuideState> {
  const [credentials, tradingStatus, tradingConfig] = await Promise.all([
    configApi.getCredentials(),
    tradingApi.status(),
    tradingApi.loadTradingConfig(),
  ])
  return {
    credentials: credentials.credentials,
    tradingStatus,
    utas: tradingConfig.utas,
  }
}

export function FirstRunGuide() {
  const { agents } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setTradingMode = useTradingMode((s) => s.setMode)
  const savingTradingMode = useTradingMode((s) => s.saving)
  const tradingModeError = useTradingMode((s) => s.error)
  const stepOverride = useMemo(() => (
    parseFirstRunStepOverride(window.location.search, ONBOARDING_TEST_MODE)
  ), [])
  const [state, setState] = useState<GuideState>(INITIAL_GUIDE_STATE)
  const [loaded, setLoaded] = useState(false)
  const [stepIndex, setStepIndex] = useState(() => (
    stepOverride ? FIRST_RUN_STEP_KEYS.indexOf(stepOverride) : 0
  ))
  const [direction, setDirection] = useState<StepDirection>('forward')
  const [modeChoiceError, setModeChoiceError] = useState<string | null>(null)
  const [showCredentialForm, setShowCredentialForm] = useState(false)
  const [showUTAForm, setShowUTAForm] = useState(false)
  const [utaEscapeSaving, setUtaEscapeSaving] = useState(false)
  const [aiPresets, setAiPresets] = useState<Preset[]>([])
  const [brokerPresets, setBrokerPresets] = useState<BrokerPreset[]>([])
  const [sessionStarted, setSessionStarted] = useState(false)
  const [sessionClosed, setSessionClosed] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  const refreshGuideState = useCallback(async () => {
    const next = await fetchGuideState()
    setState(next)
    return next
  }, [])

  useEffect(() => {
    let live = true
    fetchGuideState()
      .then((next) => {
        if (!live) return
        setState(next)
      })
      .catch(() => {
        if (live) setState(INITIAL_GUIDE_STATE)
      })
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    configApi.getPresets()
      .then(({ presets: next }) => {
        if (live) setAiPresets(next)
      })
      .catch(() => {
        if (live) setAiPresets([])
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    tradingApi.getBrokerPresets()
      .then(({ presets: next }) => {
        if (live) setBrokerPresets(next)
      })
      .catch(() => {
        if (live) setBrokerPresets([])
      })
    return () => {
      live = false
    }
  }, [])

  const model = useMemo(() => buildFirstRunGuideModel({
    agents,
    credentials: state.credentials,
    tradingStatus: state.tradingStatus,
    utas: state.utas,
    loaded,
    dismissed: dismissed && !stepOverride,
  }), [agents, dismissed, loaded, state, stepOverride])
  const guideAccess = useMemo(() => buildFirstRunGuideAccess(model), [model])
  const shouldStartGuide = loaded && (model.shouldShow || !!stepOverride)
  const shouldShowGuide = loaded && !sessionClosed && (sessionStarted || shouldStartGuide)
  const apiKeyPresets = useMemo(() => {
    const base = aiPresets.filter(isApiKeyPreset)
    return ONBOARDING_TEST_MODE && MOCK_CREDENTIAL_TEST
      ? [ONBOARDING_TEST_PRESET, ...base]
      : base
  }, [aiPresets])

  useEffect(() => {
    if (shouldStartGuide && !sessionClosed) setSessionStarted(true)
  }, [sessionClosed, shouldStartGuide])

  useEffect(() => {
    if (!shouldShowGuide) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [shouldShowGuide])

  const close = useCallback((options?: { force?: boolean; persist?: boolean }) => {
    if (!options?.force && !guideAccess.canDismiss) return false
    setSessionClosed(true)
    if (options?.persist !== false) {
      setDismissed(true)
      try {
        window.localStorage.setItem(DISMISS_KEY, '1')
      } catch {
        // Ignore storage failures; the current session still closes the guide.
      }
    }
    return true
  }, [guideAccess.canDismiss])

  const openChecklist = () => {
    close({ force: true, persist: guideAccess.canDismiss })
    openOrFocus({ kind: 'onboarding', params: {} })
  }

  const chooseTradingMode = useCallback(async (mode: TradingMode) => {
    if (state.tradingStatus?.envLocked || mode === model.mode) return
    setModeChoiceError(null)
    try {
      await setTradingMode(mode)
      await refreshGuideState()
    } catch (err) {
      setModeChoiceError(err instanceof Error ? err.message : 'Failed to save trading mode')
    }
  }, [model.mode, refreshGuideState, setTradingMode, state.tradingStatus?.envLocked])

  const saveCreatedUTA = useCallback(async (uta: Omit<UTAConfig, 'id'>) => {
    const created = await tradingApi.createUTA(uta)
    void tradingApi.reconnectUTA(created.id).catch(() => {})
    await refreshGuideState()
    setShowUTAForm(false)
    return created
  }, [refreshGuideState])

  const steps = useMemo(() => {
    const canStartWorkspace = model.hasUsableAiChain
    const modeLabel = capitalize(model.mode)
    const brokerPrimary = model.needsUTASetup
      ? 'Connect broker account'
      : model.mode === 'lite'
        ? 'Continue without UTA'
        : `Continue with ${modeLabel}`
    const brokerSecondary = model.needsUTASetup
      ? 'Continue without UTA'
      : model.mode === 'lite'
        ? 'Choose later'
        : 'Skip broker setup'
    const brokerWriteText = model.mode === 'pro'
      ? 'Controlled by account permissions.'
      : 'Blocked.'
    const runtimeText = model.runtimeLabel
    const credentialText = model.noCredentials
      ? 'No verified AI key yet.'
      : model.hasUsableAiChain
        ? 'One installed runtime can use a verified key.'
        : 'Saved keys do not match an installed runtime yet.'
    const aiTitle = model.hasAgentRuntime
      ? model.hasUsableAiChain
        ? 'Alice has a working AI path.'
        : 'Connect one runtime to AI access.'
      : 'Managed runtime was not detected.'
    const aiBody = model.hasAgentRuntime
      ? model.hasUsableAiChain
        ? 'A workspace agent can now launch with a verified AI key. Broker and portfolio setup can stay off until you choose to enable it.'
        : model.hasManagedPi
          ? 'To run workspace chat, Alice needs an agent runtime and a verified AI key. Pi is already installed here; add one key to continue.'
          : 'To run workspace chat, Alice needs an agent runtime and a verified AI key. Add a key for any installed runtime to continue.'
      : 'Packaged builds should include a managed Pi runtime. Open the setup checklist to repair the runtime path before continuing.'
    const aiPrimary = model.hasUsableAiChain
      ? 'Continue'
      : model.hasAgentRuntime
        ? 'Add AI credential'
        : 'Open setup checklist'

    return [
      {
        key: 'lite' as const,
        navLabel: 'Welcome',
        eyebrow: 'Welcome',
        title: 'OpenAlice is your AI trading workspace.',
        body: 'Use Alice to research markets and run workspace agents first. Broker accounts stay disconnected until you choose to add them, and Alice cannot place orders in this setup.',
        primary: 'Start setup',
        secondary: model.hasUsableAiChain ? 'Start without broker setup' : undefined,
        panelTitle: 'Safe by default',
        panelBody: 'You can use OpenAlice without connecting a broker. Add power step by step when you need it.',
        rows: [
          { icon: <Bot className="h-4 w-4" />, label: 'Workspace agents', value: 'Research and analysis workflows.', tone: model.hasAgentRuntime ? 'ready' as const : 'muted' as const },
          { icon: <ShieldCheck className="h-4 w-4" />, label: 'Broker mode', value: model.mode === 'lite' ? 'No broker connection active.' : `${capitalize(model.mode)} active.`, tone: 'ready' as const },
          { icon: <Lock className="h-4 w-4" />, label: 'Broker access', value: model.hasUTA ? 'Configured.' : 'Disconnected until you opt in.', tone: model.hasUTA ? 'ready' as const : 'muted' as const },
        ],
      },
      {
        key: 'ai' as const,
        navLabel: 'AI access',
        eyebrow: 'Make Alice Useful',
        title: aiTitle,
        body: aiBody,
        primary: aiPrimary,
        secondary: model.hasUsableAiChain ? 'Skip broker setup' : undefined,
        panelTitle: 'Runtime scan',
        panelBody: 'Alice is ready when one row has both a runtime and AI access.',
        rows: [
          { icon: <TerminalSquare className="h-4 w-4" />, label: 'Runtime', value: runtimeText, tone: model.hasAgentRuntime ? 'ready' as const : 'attention' as const },
          { icon: <KeyRound className="h-4 w-4" />, label: 'AI access', value: credentialText, tone: model.hasUsableAiChain ? 'ready' as const : 'attention' as const },
        ],
      },
      {
        key: 'broker' as const,
        navLabel: 'Broker access',
        eyebrow: 'Trading Mode',
        title: 'Decide whether to connect a broker account.',
        body: 'You can keep broker access off and use Alice for research, or connect an account so Alice can read positions. Write access stays blocked unless you later choose Pro permissions.',
        primary: brokerPrimary,
        secondary: brokerSecondary,
        panelTitle: 'Broker connection',
        panelBody: model.needsUTASetup
          ? 'The broker-connected options need a connector first. Connect one now, or continue without UTA and add it later.'
          : 'Choose whether Alice should connect to a broker account. You can change this later in Settings.',
        rows: [
          { icon: <Compass className="h-4 w-4" />, label: 'No broker connection', value: 'Use Alice for research; portfolio and trading stay off.', tone: model.mode === 'lite' ? 'ready' as const : 'muted' as const },
          { icon: <Lock className="h-4 w-4" />, label: 'Read-only broker connection', value: 'Include balances and positions; block orders.', tone: model.mode === 'readonly' ? 'ready' as const : 'muted' as const },
          { icon: <GitBranch className="h-4 w-4" />, label: 'Permissioned broker workflows', value: 'Use per-account approval policy.', tone: model.mode === 'pro' ? 'ready' as const : 'muted' as const },
        ],
      },
      {
        key: 'finish' as const,
        navLabel: 'Ready',
        eyebrow: 'Setup Complete',
        title: canStartWorkspace ? "You're all set." : 'OpenAlice is ready to open.',
        body: canStartWorkspace
          ? `OpenAlice is ready with a working AI path and ${model.mode === 'lite' ? 'no broker connection' : `${modeLabel} broker access`}. Broker accounts can stay disconnected until you add them.`
          : 'Alice can open without a broker account. Add an AI credential later when you want workspace chat and automated research.',
        primary: canStartWorkspace ? 'Start using Alice' : 'Open Alice now',
        secondary: 'Open checklist',
        panelTitle: 'Ready now',
        panelBody: '',
        rows: [
          { icon: <Bot className="h-4 w-4" />, label: 'Workspace chat', value: canStartWorkspace ? 'Ready.' : model.hasAgentRuntime ? 'Needs AI access.' : 'Needs runtime.', tone: canStartWorkspace ? 'ready' as const : 'attention' as const },
          { icon: <ShieldCheck className="h-4 w-4" />, label: 'Broker mode', value: model.mode === 'lite' ? 'No broker connection.' : `${modeLabel} saved.`, tone: 'ready' as const },
          { icon: <WalletCards className="h-4 w-4" />, label: 'Broker writes', value: brokerWriteText, tone: model.mode === 'pro' ? 'muted' as const : 'ready' as const },
        ],
      },
    ]
  }, [model])

  const maxReachableStepIndex = useMemo(() => {
    const index = steps.findIndex((step) => step.key === guideAccess.maxReachableStepKey)
    return index === -1 ? 0 : index
  }, [guideAccess.maxReachableStepKey, steps])

  useEffect(() => {
    const lastStepIndex = steps.length - 1
    const nextMax = Math.min(lastStepIndex, maxReachableStepIndex)
    if (stepIndex > nextMax) {
      setStepIndex(nextMax)
    } else if (stepIndex >= steps.length) {
      setStepIndex(lastStepIndex)
    }
  }, [maxReachableStepIndex, stepIndex, steps.length])

  if (!shouldShowGuide) return null

  const activeStepIndex = Math.max(0, Math.min(stepIndex, maxReachableStepIndex, steps.length - 1))
  const activeStep = steps[activeStepIndex]

  const goToStep = (nextIndex: number) => {
    const targetIndex = Math.max(0, Math.min(steps.length - 1, maxReachableStepIndex, nextIndex))
    setDirection(targetIndex > activeStepIndex ? 'forward' : 'back')
    setStepIndex(targetIndex)
  }

  const continueInLite = async () => {
    setModeChoiceError(null)
    setUtaEscapeSaving(true)
    try {
      await setTradingMode('lite')
      await refreshGuideState()
      setShowUTAForm(false)
      goToStep(activeStepIndex + 1)
    } catch (err) {
      setModeChoiceError(err instanceof Error ? err.message : 'Failed to continue without UTA')
    } finally {
      setUtaEscapeSaving(false)
    }
  }

  const runPrimary = () => {
    if (activeStep.key === 'ai' && !model.hasAgentRuntime) {
      openChecklist()
      return
    }
    if (activeStep.key === 'ai' && !model.hasUsableAiChain) {
      setShowCredentialForm(true)
      return
    }
    if (activeStep.key === 'broker') {
      if (model.needsUTASetup) {
        setShowUTAForm(true)
        return
      }
      goToStep(activeStepIndex + 1)
      return
    }
    if (activeStep.key === 'finish') {
      close()
      return
    }
    goToStep(activeStepIndex + 1)
  }

  const runSecondary = () => {
    if (!activeStep.secondary) return
    if (activeStep.key === 'finish') {
      openChecklist()
      return
    }
    if (activeStep.key === 'lite' || activeStep.key === 'ai') {
      close()
      return
    }
    if (activeStep.key === 'broker' && model.needsUTASetup) {
      void continueInLite()
      return
    }
    goToStep(activeStepIndex + 1)
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-bg text-text" data-testid="first-run-guide">
      <div className="flex h-full min-h-0 flex-col px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[980px] flex-col">
          <header className="relative shrink-0 border-b border-border pb-4 pr-12">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                OpenAlice Setup
              </div>
              <div className="mt-1 text-[15px] font-semibold leading-snug text-text sm:text-[16px]">
                Start safe. Add power only when you need it.
              </div>
            </div>
            {guideAccess.canDismiss && (
              <button
                type="button"
                onClick={() => close()}
                aria-label="Close onboarding"
                className="absolute right-0 top-0 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-overlay hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>

          <main className="flex min-h-0 flex-1 flex-col py-3 sm:py-6">
            <section
              key={activeStep.key}
              aria-live="polite"
              className={`oa-onboarding-slide-${direction} oa-onboarding-step-layout`}
            >
              <div className="min-w-0">
                {activeStep.key === 'finish' && (
                  <CompletionMark />
                )}
                <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {activeStep.eyebrow}
                </div>
                <h1 className="mt-3 max-w-[660px] text-[28px] font-semibold leading-tight text-text sm:mt-4 sm:text-[38px] lg:text-[44px]">
                  {activeStep.title}
                </h1>
                <p className="mt-3 max-w-[610px] text-[14px] leading-6 text-text-muted sm:mt-4 sm:text-[15px]">
                  {activeStep.body}
                </p>
              </div>

              <aside className="min-w-0 border-t border-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0 lg:pl-6">
                <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {activeStep.panelTitle}
                </div>
                {activeStep.panelBody && (
                  <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
                    {activeStep.panelBody}
                  </p>
                )}
                {activeStep.key === 'ai' ? (
                  <RuntimeScanTable rows={model.runtimeRows} />
                ) : activeStep.key === 'broker' ? (
                  <TradingModeChoices
                    mode={model.mode}
                    modeSource={model.modeSource}
                    envLocked={state.tradingStatus?.envLocked === true}
                    saving={savingTradingMode}
                    error={modeChoiceError ?? tradingModeError}
                    onSelect={(mode) => void chooseTradingMode(mode)}
                  />
                ) : (
                  <div className="mt-4 divide-y divide-border border-y border-border sm:mt-5">
                    {activeStep.rows.map((row) => (
                      <StatusRow
                        key={`${activeStep.key}-${row.label}`}
                        icon={row.icon}
                        label={row.label}
                        value={row.value}
                        tone={row.tone}
                      />
                    ))}
                  </div>
                )}
              </aside>
            </section>

            <footer
              className="mt-3 flex shrink-0 flex-col gap-3 border-t border-border pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4"
              data-testid="first-run-guide-footer"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2">
                  {steps.map((step, index) => {
                    const locked = index > maxReachableStepIndex
                    return (
                      <button
                        key={step.key}
                      type="button"
                      onClick={() => goToStep(index)}
                      disabled={locked}
                      className={`h-2.5 rounded-full transition-all ${
                          index === activeStepIndex
                            ? 'w-8 bg-accent'
                            : locked
                              ? 'w-2.5 cursor-default bg-bg-tertiary/50 opacity-60'
                              : 'w-2.5 bg-bg-tertiary hover:bg-text-muted/50'
                        }`}
                        aria-label={`Go to ${step.navLabel}`}
                        aria-current={index === activeStepIndex ? 'step' : undefined}
                      />
                    )
                  })}
                </div>
                <div className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  Step {activeStepIndex + 1} of {steps.length} · {activeStep.navLabel}
                </div>
              </div>

              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  onClick={() => goToStep(activeStepIndex - 1)}
                  disabled={activeStepIndex === 0}
                  className="rounded-md border border-border bg-bg px-3 py-2 text-[13px] font-medium text-text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={runPrimary}
                  className="flex min-w-0 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent/90"
                >
                  <span className="min-w-0 truncate">{activeStep.primary}</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>
                {activeStep.secondary && (
                  <button
                    type="button"
                    onClick={runSecondary}
                    className="col-span-2 rounded-md px-3 py-2 text-[12px] font-medium text-text-muted transition-colors hover:bg-overlay hover:text-text sm:col-span-1"
                  >
                    {activeStep.secondary}
                  </button>
                )}
              </div>
            </footer>
          </main>
        </div>
      </div>
      {showCredentialForm && (
        <CredentialModal
          mode="add"
          presets={apiKeyPresets}
          initialPresetId={ONBOARDING_TEST_MODE && MOCK_CREDENTIAL_TEST ? ONBOARDING_TEST_PRESET_ID : undefined}
          initialApiKey={ONBOARDING_TEST_MODE && MOCK_CREDENTIAL_TEST ? ONBOARDING_TEST_API_KEY : undefined}
          onClose={() => setShowCredentialForm(false)}
          onSaved={async () => {
            const nextState = await refreshGuideState()
            setShowCredentialForm(false)
            const nextModel = buildFirstRunGuideModel({
              agents,
              credentials: nextState.credentials,
              tradingStatus: nextState.tradingStatus,
              utas: nextState.utas,
              loaded: true,
              dismissed: false,
            })
            if (activeStep.key === 'ai' && nextModel.hasUsableAiChain) {
              goToStep(activeStepIndex + 1)
            }
          }}
        />
      )}
      {showUTAForm && (
        <CreateUTADialog
          presets={brokerPresets}
          initialReadOnly={model.mode === 'readonly'}
          onClose={() => setShowUTAForm(false)}
          onOpenExisting={async () => {
            await refreshGuideState()
            setShowUTAForm(false)
            if (activeStep.key === 'broker') {
              goToStep(activeStepIndex + 1)
            }
          }}
          onSave={async (uta) => {
            const created = await saveCreatedUTA(uta)
            if (activeStep.key === 'broker') {
              goToStep(activeStepIndex + 1)
            }
            return created
          }}
          escapeAction={{
            label: 'Continue without UTA',
            onClick: continueInLite,
            disabled: utaEscapeSaving,
          }}
        />
      )}
    </div>
  )
}

function StatusRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  tone: RowTone
}) {
  const ToneIcon = tone === 'attention' ? AlertTriangle : CheckCircle2
  const toneClass = tone === 'ready'
    ? 'text-green'
    : tone === 'attention'
      ? 'text-red'
      : 'text-text-muted'
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-2.5 sm:py-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-text-muted">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-text">{label}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-text-muted">{value}</div>
      </div>
      <ToneIcon className={`mt-1 h-4 w-4 shrink-0 ${toneClass}`} />
    </div>
  )
}

function CompletionMark() {
  return (
    <div className="oa-onboarding-completion" aria-hidden>
      <span className="oa-onboarding-completion-line oa-onboarding-completion-line-a" />
      <span className="oa-onboarding-completion-line oa-onboarding-completion-line-b" />
      <span className="oa-onboarding-completion-line oa-onboarding-completion-line-c" />
      <div className="oa-onboarding-completion-ring">
        <CheckCircle2 className="h-9 w-9 text-green" strokeWidth={1.8} />
      </div>
    </div>
  )
}

function TradingModeChoices({
  mode,
  modeSource,
  envLocked,
  saving,
  error,
  onSelect,
}: {
  mode: TradingMode
  modeSource: string
  envLocked: boolean
  saving: TradingMode | null
  error: string | null
  onSelect: (mode: TradingMode) => void
}) {
  const choices: Array<{
    mode: TradingMode
    icon: ReactNode
    label: string
    description: string
  }> = [
    {
      mode: 'lite',
      icon: <Compass className="h-4 w-4" />,
      label: 'Research only',
      description: 'No broker connector. Portfolio and trading stay off.',
    },
    {
      mode: 'readonly',
      icon: <Lock className="h-4 w-4" />,
      label: 'Read-only broker',
      description: 'Read balances and positions; block orders.',
    },
    {
      mode: 'pro',
      icon: <GitBranch className="h-4 w-4" />,
      label: 'Pro broker',
      description: 'Use per-account approval policy.',
    },
  ]
  const disabled = envLocked || saving !== null
  return (
    <div className="mt-4 sm:mt-5">
      <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent">
        <MousePointerClick className="h-3.5 w-3.5" />
        Choose broker access
      </div>
      <div className="grid gap-2">
        {choices.map((choice) => {
          const active = choice.mode === mode
          const isSaving = saving === choice.mode
          return (
            <button
              key={choice.mode}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(choice.mode)}
              className={`grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-3 text-left transition-[border-color,background-color,color,transform] ${
                active
                  ? 'border-accent/55 bg-accent/10 text-text'
                  : 'border-border bg-bg text-text-muted hover:border-accent/35 hover:bg-bg-tertiary hover:text-text'
              } ${disabled ? 'cursor-default opacity-75' : 'cursor-pointer active:scale-[0.99]'}`}
            >
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                active ? 'bg-accent/15 text-accent' : 'bg-bg-tertiary text-text-muted'
              }`}>
                {choice.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">{choice.label}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-text-muted">
                  {choice.description}
                </span>
                {isSaving && (
                  <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-accent">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" aria-hidden />
                    Saving
                  </span>
                )}
                {!isSaving && (
                  <span className={`mt-1.5 inline-flex text-[11px] font-medium ${
                    active ? 'text-accent' : 'text-text-muted/70'
                  }`}>
                    {active ? 'Selected' : 'Choose this option'}
                  </span>
                )}
              </span>
              {active ? (
                <CheckCircle2 className="mt-1.5 h-4 w-4 shrink-0 text-green" />
              ) : (
                <Circle className="mt-1.5 h-4 w-4 shrink-0 text-text-muted" />
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-3 text-[11px] leading-relaxed text-text-muted/70">
        {envLocked ? (
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
            Broker mode is locked by the current environment.
          </span>
        ) : (
          `Current source: ${modeSource}`
        )}
      </div>
      {error && (
        <div className="mt-2 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] leading-relaxed text-red">
          {error}
        </div>
      )}
    </div>
  )
}

function RuntimeScanTable({
  rows,
}: {
  rows: Array<{
    id: string
    displayName: string
    installed: boolean
    loginRuntime: boolean
    compatibleCredentialCount: number
    chainReady: boolean
    accessLabel: string
  }>
}) {
  return (
    <div className="mt-4 overflow-hidden border-y border-border sm:mt-5">
      <div className="hidden border-b border-border py-2 text-[10px] font-medium uppercase tracking-wide text-text-muted sm:grid sm:grid-cols-[minmax(0,1fr)_72px_116px] sm:gap-3">
        <span>Runtime</span>
        <span>CLI</span>
        <span>AI access</span>
      </div>
      {rows.map((row) => {
        const tone: RowTone = row.chainReady ? 'ready' : row.installed ? 'attention' : 'muted'
        const toneClass = tone === 'ready'
          ? 'text-green'
          : tone === 'attention'
            ? 'text-red'
            : 'text-text-muted'
        const cliText = row.installed ? 'Installed' : 'Missing'
        const accessText = row.chainReady
          ? 'Ready'
          : row.installed && row.compatibleCredentialCount > 0
            ? 'Ready'
            : row.accessLabel
        return (
          <div
            key={row.id}
            className="grid min-w-0 grid-cols-1 gap-2 border-b border-border py-2.5 text-[12px] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_72px_116px] sm:gap-3 sm:py-3"
            data-testid="runtime-scan-row"
          >
            <div className="min-w-0">
              <div className="font-medium text-text">{row.displayName}</div>
              <div className="mt-0.5 text-[10.5px] text-text-muted">
                {row.loginRuntime ? 'CLI login or AI key' : 'AI key'}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 sm:hidden">
                <span className={row.installed ? 'text-green' : 'text-text-muted'}>{cliText}</span>
                <span className={toneClass}>{accessText}</span>
              </div>
            </div>
            <div className={`hidden sm:block ${row.installed ? 'text-green' : 'text-text-muted'}`}>
              {cliText}
            </div>
            <div className={`hidden sm:block ${toneClass}`}>
              {accessText}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
