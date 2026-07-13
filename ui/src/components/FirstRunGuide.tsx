import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  Compass,
  GitBranch,
  KeyRound,
  Languages,
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
import { LOCALE_LABELS, useLocale, useSetLocale } from '../i18n/useLocale'
import type { AppLocale } from '../lib/intl'
import {
  getAgentRuntimeReadiness,
  probeAgentRuntimeReadiness,
  type AgentRuntimeReadinessSnapshot,
} from './workspace/api'

const BASE_DISMISS_KEY = 'openalice.onboarding.firstRunGuide.dismissed.v3'
const STORAGE_SUFFIX = import.meta.env.VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX?.trim()
const DISMISS_KEY = STORAGE_SUFFIX ? `${BASE_DISMISS_KEY}.${STORAGE_SUFFIX}` : BASE_DISMISS_KEY
const ONBOARDING_TEST_MODE = import.meta.env.VITE_OPENALICE_ONBOARDING_TEST === '1'
const MOCK_CREDENTIAL_TEST = import.meta.env.VITE_OPENALICE_CREDENTIAL_TEST_MODE === 'mock'
const ONBOARDING_TEST_PRESET_ID = 'openalice-onboarding-test'
const ONBOARDING_TEST_API_KEY = 'oa_test_ok'
const ONBOARDING_TEST_AI_BASE_URL = import.meta.env.VITE_OPENALICE_ONBOARDING_AI_BASE_URL?.trim()
  || 'http://127.0.0.1:0/v1'

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
      wires: { 'openai-chat': ONBOARDING_TEST_AI_BASE_URL },
    },
  ],
}

interface GuideState {
  credentials: CredentialSummary[]
  runtimeReadiness: AgentRuntimeReadinessSnapshot | null
  tradingStatus: TradingServiceStatus | null
  utas: UTAConfig[]
}

type StepDirection = 'forward' | 'back'
type RowTone = 'ready' | 'attention' | 'muted'
const FIRST_RUN_LOCALES: AppLocale[] = ['en', 'zh', 'ja', 'zh-Hant']

const INITIAL_GUIDE_STATE: GuideState = {
  credentials: [],
  runtimeReadiness: null,
  tradingStatus: null,
  utas: [],
}

async function fetchGuideState(): Promise<GuideState> {
  const [credentials, runtimeReadiness, tradingStatus, tradingConfig] = await Promise.all([
    configApi.getCredentials(),
    getAgentRuntimeReadiness().catch(() => null),
    tradingApi.status(),
    tradingApi.loadTradingConfig(),
  ])
  return {
    credentials: credentials.credentials,
    runtimeReadiness,
    tradingStatus,
    utas: tradingConfig.utas,
  }
}

export function FirstRunGuide() {
  const { t } = useTranslation()
  const locale = useLocale()
  const setLocale = useSetLocale()
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
  const [runtimeProbeRunning, setRuntimeProbeRunning] = useState(false)
  const [runtimeProbeAttempted, setRuntimeProbeAttempted] = useState(false)
  const [runtimeProbeError, setRuntimeProbeError] = useState<string | null>(null)
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

  const runRuntimeReadinessProbe = useCallback(async (agent?: string) => {
    setRuntimeProbeRunning(true)
    setRuntimeProbeAttempted(true)
    setRuntimeProbeError(null)
    try {
      const runtimeReadiness = await probeAgentRuntimeReadiness(agent, (snapshot) => {
        setState((prev) => ({ ...prev, runtimeReadiness: snapshot }))
      })
      setState((prev) => ({ ...prev, runtimeReadiness }))
      return runtimeReadiness
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setRuntimeProbeError(message)
      return null
    } finally {
      setRuntimeProbeRunning(false)
    }
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
    runtimeReadiness: state.runtimeReadiness,
    credentials: state.credentials,
    tradingStatus: state.tradingStatus,
    utas: state.utas,
    loaded,
    dismissed: dismissed && !stepOverride,
  }), [agents, dismissed, loaded, state, stepOverride])
  const guideAccess = useMemo(() => buildFirstRunGuideAccess(model), [model])
  const shouldStartGuide = loaded && (model.shouldShow || !!stepOverride)
  const shouldShowGuide = loaded && !sessionClosed && (sessionStarted || shouldStartGuide)
  const requestedStepKey = FIRST_RUN_STEP_KEYS[
    Math.max(0, Math.min(stepIndex, FIRST_RUN_STEP_KEYS.length - 1))
  ]
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
    if (requestedStepKey !== 'ai') return
    if (model.hasUsableAiChain || model.runtimeProbeChecking) return
    if (runtimeProbeAttempted || runtimeProbeRunning) return
    void runRuntimeReadinessProbe()
  }, [
    model.hasUsableAiChain,
    model.runtimeProbeChecking,
    requestedStepKey,
    runRuntimeReadinessProbe,
    runtimeProbeAttempted,
    runtimeProbeRunning,
    shouldShowGuide,
  ])

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
      setModeChoiceError(err instanceof Error ? err.message : t('firstRunGuide.error.saveTradingMode'))
    }
  }, [model.mode, refreshGuideState, setTradingMode, state.tradingStatus?.envLocked, t])

  const saveCreatedUTA = useCallback(async (uta: Omit<UTAConfig, 'id'>) => {
    const created = await tradingApi.createUTA(uta)
    void tradingApi.reconnectUTA(created.id).catch(() => {})
    await refreshGuideState()
    setShowUTAForm(false)
    return created
  }, [refreshGuideState])

  const steps = useMemo(() => {
    const canStartWorkspace = model.hasUsableAiChain
    const modeLabel = model.mode === 'readonly'
      ? t('firstRunGuide.mode.readonly')
      : model.mode === 'pro'
        ? t('firstRunGuide.mode.pro')
        : t('firstRunGuide.mode.lite')
    const modeAccessLabel = model.mode === 'lite'
      ? t('firstRunGuide.finish.noBrokerAccess')
      : t('firstRunGuide.finish.modeBrokerAccess', { mode: modeLabel })
    const brokerPrimary = model.needsUTASetup
      ? t('firstRunGuide.action.connectBroker')
      : model.mode === 'lite'
        ? t('firstRunGuide.action.continueWithoutUTA')
        : t('firstRunGuide.action.continueWithMode', { mode: modeLabel })
    const brokerSecondary = model.needsUTASetup
      ? t('firstRunGuide.action.continueWithoutUTA')
      : model.mode === 'lite'
        ? t('firstRunGuide.action.chooseLater')
        : t('firstRunGuide.action.skipBrokerSetup')
    const brokerWriteText = model.mode === 'pro'
      ? t('firstRunGuide.broker.writesControlled')
      : t('firstRunGuide.broker.writesBlocked')
    const installedRuntimeCount = model.runtimeRows.filter((row) => row.installed).length
    const runtimeText = model.hasAgentRuntime
      ? t('firstRunGuide.ai.runtimeInstalled', { count: installedRuntimeCount })
      : model.hasManagedPi
        ? t('firstRunGuide.ai.managedPiMissing')
        : t('firstRunGuide.ai.runtimeMissing')
    const credentialText = model.noCredentials
      ? t('firstRunGuide.ai.noVerifiedKey')
      : t('firstRunGuide.ai.keyMismatch')
    const aiAccessText = model.hasUsableAiChain
      ? t('firstRunGuide.ai.runtimeReady')
      : runtimeProbeError
        ? t('firstRunGuide.ai.probeFailed')
        : model.aiRepairTarget === 'ai-provider'
          ? t('firstRunGuide.ai.providerNeeded')
          : model.runtimeProbeChecking || runtimeProbeRunning
            ? t('firstRunGuide.ai.checkingRuntime')
            : model.aiRepairTarget === 'cli-login'
            ? t('firstRunGuide.ai.cliLoginNeeded')
              : model.aiRepairTarget === 'runtime-install'
                ? t('firstRunGuide.ai.runtimeMissing')
                : credentialText
    const aiTitle = model.hasAgentRuntime
      ? model.hasUsableAiChain
        ? t('firstRunGuide.ai.titleReady')
        : t('firstRunGuide.ai.titleConnect')
      : t('firstRunGuide.ai.titleMissingRuntime')
    const aiBody = model.hasAgentRuntime
      ? model.hasUsableAiChain
        ? t('firstRunGuide.ai.bodyReady')
        : model.aiRepairTarget === 'ai-provider'
          ? t('firstRunGuide.ai.bodyAddKey')
          : model.runtimeProbeChecking || runtimeProbeRunning
            ? t('firstRunGuide.ai.bodyChecking')
            : model.aiRepairTarget === 'cli-login'
            ? t('firstRunGuide.ai.bodyCliLogin')
              : model.hasManagedPi
                ? t('firstRunGuide.ai.bodyPiInstalled')
                : t('firstRunGuide.ai.bodyRetry')
      : t('firstRunGuide.ai.bodyMissingRuntime')
    const aiPrimary = model.hasUsableAiChain
      ? t('firstRunGuide.common.continue')
      : model.aiRepairTarget === 'ai-provider'
          ? t('firstRunGuide.action.addCredential')
          : model.runtimeProbeChecking || runtimeProbeRunning
            ? t('firstRunGuide.common.checking')
            : model.aiRepairTarget === 'retry'
            ? t('firstRunGuide.action.testRuntime')
            : t('firstRunGuide.action.openChecklist')

    return [
      {
        key: 'language' as const,
        navLabel: t('firstRunGuide.language.navLabel'),
        eyebrow: t('firstRunGuide.language.eyebrow'),
        title: t('firstRunGuide.language.title'),
        body: t('firstRunGuide.language.body'),
        primary: t('firstRunGuide.language.primary'),
        secondary: undefined,
        panelTitle: t('firstRunGuide.language.panelTitle'),
        panelBody: t('firstRunGuide.language.panelBody'),
        rows: [],
      },
      {
        key: 'lite' as const,
        navLabel: t('firstRunGuide.welcome.navLabel'),
        eyebrow: t('firstRunGuide.welcome.eyebrow'),
        title: t('firstRunGuide.welcome.title'),
        body: t('firstRunGuide.welcome.body'),
        primary: t('firstRunGuide.action.startSetup'),
        secondary: model.hasUsableAiChain ? t('firstRunGuide.action.startWithoutBrokerSetup') : undefined,
        panelTitle: t('firstRunGuide.welcome.panelTitle'),
        panelBody: t('firstRunGuide.welcome.panelBody'),
        rows: [
          { icon: <Bot className="h-4 w-4" />, label: t('firstRunGuide.welcome.workspaceAgents'), value: t('firstRunGuide.welcome.workspaceAgentsValue'), tone: model.hasAgentRuntime ? 'ready' as const : 'muted' as const },
          { icon: <ShieldCheck className="h-4 w-4" />, label: t('firstRunGuide.welcome.brokerMode'), value: model.mode === 'lite' ? t('firstRunGuide.welcome.noBrokerConnectionActive') : t('firstRunGuide.welcome.modeActive', { mode: modeLabel }), tone: 'ready' as const },
          { icon: <Lock className="h-4 w-4" />, label: t('firstRunGuide.welcome.brokerAccess'), value: model.hasUTA ? t('firstRunGuide.common.configured') : t('firstRunGuide.welcome.disconnectedUntilOptIn'), tone: model.hasUTA ? 'ready' as const : 'muted' as const },
        ],
      },
      {
        key: 'ai' as const,
        navLabel: t('firstRunGuide.ai.navLabel'),
        eyebrow: t('firstRunGuide.ai.eyebrow'),
        title: aiTitle,
        body: aiBody,
        primary: aiPrimary,
        secondary: model.hasUsableAiChain ? t('firstRunGuide.action.skipBrokerSetup') : undefined,
        panelTitle: t('firstRunGuide.ai.panelTitle'),
        panelBody: t('firstRunGuide.ai.panelBody'),
        rows: [
          { icon: <TerminalSquare className="h-4 w-4" />, label: t('firstRunGuide.ai.runtime'), value: runtimeText, tone: model.hasAgentRuntime ? 'ready' as const : 'attention' as const },
          { icon: <KeyRound className="h-4 w-4" />, label: t('firstRunGuide.ai.aiAccess'), value: aiAccessText, tone: model.hasUsableAiChain ? 'ready' as const : 'attention' as const },
        ],
      },
      {
        key: 'broker' as const,
        navLabel: t('firstRunGuide.broker.navLabel'),
        eyebrow: t('firstRunGuide.broker.eyebrow'),
        title: t('firstRunGuide.broker.title'),
        body: t('firstRunGuide.broker.body'),
        primary: brokerPrimary,
        secondary: brokerSecondary,
        panelTitle: t('firstRunGuide.broker.panelTitle'),
        panelBody: model.needsUTASetup
          ? t('firstRunGuide.broker.panelBodyNeedsUTA')
          : t('firstRunGuide.broker.panelBodyChoose'),
        rows: [
          { icon: <Compass className="h-4 w-4" />, label: t('firstRunGuide.broker.noBrokerConnection'), value: t('firstRunGuide.broker.noBrokerConnectionValue'), tone: model.mode === 'lite' ? 'ready' as const : 'muted' as const },
          { icon: <Lock className="h-4 w-4" />, label: t('firstRunGuide.broker.readOnlyBrokerConnection'), value: t('firstRunGuide.broker.readOnlyBrokerConnectionValue'), tone: model.mode === 'readonly' ? 'ready' as const : 'muted' as const },
          { icon: <GitBranch className="h-4 w-4" />, label: t('firstRunGuide.broker.permissionedBrokerWorkflows'), value: t('firstRunGuide.broker.permissionedBrokerWorkflowsValue'), tone: model.mode === 'pro' ? 'ready' as const : 'muted' as const },
        ],
      },
      {
        key: 'finish' as const,
        navLabel: t('firstRunGuide.finish.navLabel'),
        eyebrow: t('firstRunGuide.finish.eyebrow'),
        title: canStartWorkspace ? t('firstRunGuide.finish.titleReady') : t('firstRunGuide.finish.titleOpen'),
        body: canStartWorkspace
          ? t('firstRunGuide.finish.bodyReady', { access: modeAccessLabel })
          : t('firstRunGuide.finish.bodyOpen'),
        primary: canStartWorkspace ? t('firstRunGuide.action.startUsingAlice') : t('firstRunGuide.action.openAliceNow'),
        secondary: t('firstRunGuide.action.openChecklist'),
        panelTitle: t('firstRunGuide.finish.panelTitle'),
        panelBody: '',
        rows: [
          { icon: <Bot className="h-4 w-4" />, label: t('firstRunGuide.ai.workspaceChat'), value: canStartWorkspace ? t('firstRunGuide.common.ready') : model.hasAgentRuntime ? t('firstRunGuide.ai.needsAiAccess') : t('firstRunGuide.ai.needsRuntime'), tone: canStartWorkspace ? 'ready' as const : 'attention' as const },
          { icon: <ShieldCheck className="h-4 w-4" />, label: t('firstRunGuide.finish.brokerMode'), value: model.mode === 'lite' ? t('firstRunGuide.finish.noBrokerConnection') : t('firstRunGuide.finish.modeSaved', { mode: modeLabel }), tone: 'ready' as const },
          { icon: <WalletCards className="h-4 w-4" />, label: t('firstRunGuide.finish.brokerWrites'), value: brokerWriteText, tone: model.mode === 'pro' ? 'muted' as const : 'ready' as const },
        ],
      },
    ]
  }, [model, runtimeProbeError, runtimeProbeRunning, t])

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
  const primaryDisabled = activeStep.key === 'ai' &&
    !model.hasUsableAiChain &&
    model.aiRepairTarget !== 'ai-provider' &&
    (runtimeProbeRunning || model.runtimeProbeChecking)
  const primaryAction = activeStep.key !== 'ai'
    ? activeStep.key
    : model.hasUsableAiChain
      ? 'continue'
      : model.aiRepairTarget === 'ai-provider'
        ? 'add-credential'
        : primaryDisabled
          ? 'checking'
          : !model.hasAgentRuntime ||
              model.aiRepairTarget === 'runtime-install' ||
              model.aiRepairTarget === 'cli-login'
            ? 'checklist'
            : 'probe'

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
      setModeChoiceError(err instanceof Error ? err.message : t('firstRunGuide.error.continueWithoutUTA'))
    } finally {
      setUtaEscapeSaving(false)
    }
  }

  const runPrimary = () => {
    if (activeStep.key === 'ai' && !model.hasUsableAiChain) {
      if (
        (runtimeProbeRunning || model.runtimeProbeChecking) &&
        model.aiRepairTarget !== 'ai-provider'
      ) return
      if (!model.hasAgentRuntime || model.aiRepairTarget === 'runtime-install' || model.aiRepairTarget === 'cli-login') {
        openChecklist()
        return
      }
      if (model.aiRepairTarget === 'ai-provider') {
        setShowCredentialForm(true)
        return
      }
      void runRuntimeReadinessProbe()
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
                {t('firstRunGuide.header.setup')}
              </div>
              <div className="mt-1 text-[15px] font-semibold leading-snug text-text sm:text-[16px]">
                {t('firstRunGuide.header.subtitle')}
              </div>
            </div>
            {guideAccess.canDismiss && (
              <button
                type="button"
                onClick={() => close()}
                aria-label={t('firstRunGuide.header.close')}
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
              data-testid="first-run-guide-step"
              data-onboarding-step={activeStep.key}
              className={`oa-onboarding-slide-${direction} oa-onboarding-step-layout`}
            >
              <div className="min-w-0">
                {activeStep.key === 'finish' && (
                  <CompletionMark />
                )}
                <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {activeStep.eyebrow}
                </div>
                <h1 className="oa-onboarding-title mt-3 max-w-[660px] text-[28px] font-semibold leading-tight text-text sm:mt-4 sm:text-[38px] lg:text-[44px]">
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
                {activeStep.key === 'language' ? (
                  <LanguageChoices locale={locale} onSelect={setLocale} />
                ) : activeStep.key === 'ai' ? (
                  <RuntimeScanTable rows={model.runtimeRows} error={runtimeProbeError} />
                ) : activeStep.key === 'broker' ? (
                  <TradingModeChoices
                    mode={model.mode}
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
                  {t('firstRunGuide.common.step', {
                    current: activeStepIndex + 1,
                    total: steps.length,
                    label: activeStep.navLabel,
                  })}
                </div>
              </div>

              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  onClick={() => goToStep(activeStepIndex - 1)}
                  disabled={activeStepIndex === 0}
                  className="rounded-md border border-border bg-bg px-3 py-2 text-[13px] font-medium text-text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
                >
                  {t('firstRunGuide.common.back')}
                </button>
                <button
                  type="button"
                  onClick={runPrimary}
                  disabled={primaryDisabled}
                  data-testid="first-run-guide-primary"
                  data-onboarding-action={primaryAction}
                  className="flex min-w-0 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-accent"
                >
                  <span className="min-w-0 truncate">{activeStep.primary}</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>
                {activeStep.secondary && (
                  <button
                    type="button"
                    onClick={runSecondary}
                    data-testid="first-run-guide-secondary"
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
            // The credential is durable now; release the modal immediately.
            // Runtime probes continue in the onboarding surface and update rows
            // incrementally, so a slow unrelated CLI cannot trap the user in a
            // saving dialog after another runtime is already usable.
            setShowCredentialForm(false)
            const runtimeReadiness = await runRuntimeReadinessProbe()
            const nextModel = buildFirstRunGuideModel({
              agents,
              runtimeReadiness: runtimeReadiness ?? nextState.runtimeReadiness,
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
            label: t('firstRunGuide.action.continueWithoutUTA'),
            onClick: continueInLite,
            disabled: utaEscapeSaving,
          }}
        />
      )}
    </div>
  )
}

function LanguageChoices({
  locale,
  onSelect,
}: {
  locale: AppLocale
  onSelect: (locale: AppLocale) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 grid gap-2 sm:mt-5">
      {FIRST_RUN_LOCALES.map((option) => {
        const active = option === locale
        const description =
          option === 'en' ? t('firstRunGuide.language.option.en')
          : option === 'zh' ? t('firstRunGuide.language.option.zh')
          : option === 'ja' ? t('firstRunGuide.language.option.ja')
          : t('firstRunGuide.language.option.zh-Hant')
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(option)}
            className={`grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-3 text-left transition-[border-color,background-color,color,transform] ${
              active
                ? 'border-accent/55 bg-accent/10 text-text'
                : 'border-border bg-bg text-text-muted hover:border-accent/35 hover:bg-bg-tertiary hover:text-text'
            } active:scale-[0.99]`}
          >
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
              active ? 'bg-accent/15 text-accent' : 'bg-bg-tertiary text-text-muted'
            }`}>
              <Languages className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text">{LOCALE_LABELS[option]}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-text-muted">
                {description}
              </span>
              <span className={`mt-1.5 inline-flex text-[11px] font-medium ${
                active ? 'text-accent' : 'text-text-muted/70'
              }`}>
                {active ? t('firstRunGuide.language.current') : t('firstRunGuide.language.choose')}
              </span>
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
  envLocked,
  saving,
  error,
  onSelect,
}: {
  mode: TradingMode
  envLocked: boolean
  saving: TradingMode | null
  error: string | null
  onSelect: (mode: TradingMode) => void
}) {
  const { t } = useTranslation()
  const choices: Array<{
    mode: TradingMode
    icon: ReactNode
    label: string
    description: string
  }> = [
    {
      mode: 'lite',
      icon: <Compass className="h-4 w-4" />,
      label: t('firstRunGuide.tradingChoices.researchOnly'),
      description: t('firstRunGuide.tradingChoices.researchOnlyDescription'),
    },
    {
      mode: 'readonly',
      icon: <Lock className="h-4 w-4" />,
      label: t('firstRunGuide.tradingChoices.readOnlyBroker'),
      description: t('firstRunGuide.tradingChoices.readOnlyBrokerDescription'),
    },
    {
      mode: 'pro',
      icon: <GitBranch className="h-4 w-4" />,
      label: t('firstRunGuide.tradingChoices.proBroker'),
      description: t('firstRunGuide.tradingChoices.proBrokerDescription'),
    },
  ]
  const disabled = envLocked || saving !== null
  return (
    <div className="mt-4 sm:mt-5">
      <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent">
        <MousePointerClick className="h-3.5 w-3.5" />
        {t('firstRunGuide.tradingChoices.badge')}
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
                    {t('firstRunGuide.common.saving')}
                  </span>
                )}
                {!isSaving && (
                  <span className={`mt-1.5 inline-flex text-[11px] font-medium ${
                    active ? 'text-accent' : 'text-text-muted/70'
                  }`}>
                    {active ? t('firstRunGuide.common.selected') : t('firstRunGuide.common.chooseThisOption')}
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
      {envLocked && (
        <div className="mt-3 text-[11px] leading-relaxed text-text-muted/70">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
            {t('firstRunGuide.tradingChoices.envLocked')}
          </span>
        </div>
      )}
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
  error,
}: {
  error: string | null
  rows: Array<{
    id: string
    displayName: string
    installed: boolean
    loginRuntime: boolean
    compatibleCredentialCount: number
    chainReady: boolean
    accessLabel: string
    source: string
    readinessStatus: string
    repairTarget: string
    readinessMessage: string | null
  }>
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 sm:mt-5">
      {error && (
        <div className="mb-3 break-words rounded-md border border-red/25 bg-red/5 px-3 py-2 text-[12px] leading-relaxed text-red">
          {error}
        </div>
      )}
      <div className="overflow-hidden border-y border-border">
      <div className="hidden border-b border-border py-2 text-[10px] font-medium uppercase tracking-wide text-text-muted sm:grid sm:grid-cols-[minmax(0,1fr)_72px_minmax(112px,140px)] sm:gap-3">
          <span>{t('firstRunGuide.ai.runtime')}</span>
          <span>{t('firstRunGuide.ai.cli')}</span>
          <span>{t('firstRunGuide.ai.readyProbe')}</span>
      </div>
      {rows.map((row) => {
        const tone: RowTone = row.chainReady ? 'ready' : row.installed ? 'attention' : 'muted'
        const toneClass = tone === 'ready'
          ? 'text-green'
          : tone === 'attention'
            ? 'text-red'
            : 'text-text-muted'
        const cliText = row.installed ? t('firstRunGuide.ai.installed') : t('firstRunGuide.ai.missing')
        const accessText = row.chainReady
          ? t('firstRunGuide.ai.ready')
          : row.readinessStatus === 'checking'
            ? t('firstRunGuide.ai.checkingRuntime')
            : row.readinessStatus === 'not_installed'
              ? t('firstRunGuide.ai.cliNotInstalled')
            : row.readinessStatus === 'auth_required'
              ? row.repairTarget === 'ai-provider'
                ? t('firstRunGuide.ai.providerNeeded')
                : t('firstRunGuide.ai.cliLoginNeeded')
                : row.readinessStatus === 'provider_required'
                  ? t('firstRunGuide.ai.providerNeeded')
                  : row.readinessStatus === 'unknown'
                    ? t('firstRunGuide.ai.notChecked')
                    : t('firstRunGuide.ai.probeFailed')
        return (
          <div
            key={row.id}
            className="grid min-w-0 grid-cols-1 gap-2 border-b border-border py-2.5 text-[12px] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_72px_minmax(112px,140px)] sm:gap-3 sm:py-3"
            data-testid="runtime-scan-row"
          >
            <div className="min-w-0">
              <div className="font-medium text-text">{row.displayName}</div>
              <div className="mt-0.5 text-[10.5px] text-text-muted">
                {row.loginRuntime ? t('firstRunGuide.ai.loginOrKey') : t('firstRunGuide.ai.aiKey')}
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
    </div>
  )
}
