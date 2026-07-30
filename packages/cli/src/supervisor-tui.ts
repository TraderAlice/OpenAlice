import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Component, KeyId } from '@earendil-works/pi-tui'

import { diagnoseRuntime } from './doctor.mjs'
import {
  inspectRuntime,
  openRuntime,
  startRuntime,
  stopRuntime,
} from './lifecycle.mjs'
import {
  buildManagedPiEnv,
  resolveLaunchContext,
  type InstanceLaunchConfig,
  type MachineSupervisorConfig,
  type ResolvedLaunchContext,
  type TuiLaunchFlags,
} from './launch-context.ts'
import { resolveInstalledLayout } from './install-layout.mjs'
import { readInstallSource } from './install-source.mjs'
import { findOpenAliceRoot } from './local-start.mjs'
import { readRuntimeLogs } from './logs.mjs'
import {
  inspectManagedSource,
  prepareManagedSource,
  type ManagedSourcePlan,
  type ManagedSourceResult,
} from './managed-source.ts'
import { loadPiTui } from './pi-tui-loader.ts'
import {
  persistInstanceLaunchConfig,
  resolveStoredLaunchContext,
} from './supervisor-config.ts'
import {
  checkForUpdate,
  maybeNotifyUpdate,
} from './update.mjs'

const SILENT_OUTPUT = Object.freeze({ write: () => true })

interface RuntimeSummary {
  class?: string
  state?: string
  home?: string
  productVersion?: string
  runtimeVersion?: string
  uptimeSeconds?: number
  endpoints?: { web?: string | null }
  owner?: {
    surface?: string
    pid?: number
    launchRoot?: string
  } | null
  provider?: {
    kind?: string
    root?: string
  }
  components?: {
    alice?: string
    uta?: string
    connector?: string
  }
}

interface RuntimeLogs {
  entries?: Array<{ text?: string }>
  truncated?: boolean
}

interface DoctorReport {
  overall?: string
  summary?: {
    passed?: number
    warnings?: number
    failures?: number
  }
  checks?: Array<{
    status?: string
    summary?: string
    detail?: string
  }>
}

interface UpdateResult {
  status?: string
  currentVersion?: string
  latestVersion?: string
  message?: string
}

export type SupervisorPanel = 'overview' | 'logs' | 'doctor' | 'help'
export type SupervisorAction =
  | 'start'
  | 'open'
  | 'stop'
  | 'restart'
  | 'logs'
  | 'doctor'
  | 'update'

export interface SupervisorSnapshot {
  version: string
  channel: string
  runtime: RuntimeSummary | null
  context?: ResolvedLaunchContext
  diagnostic?: string
  panel?: SupervisorPanel
  busy?: string
  notice?: string
  confirmation?: 'stop' | 'restart' | 'managed-source'
  logs?: RuntimeLogs | null
  doctor?: DoctorReport | null
  update?: UpdateResult | null
  managedSource?: ManagedSourcePlan | null
}

export interface SupervisorTuiDependencies {
  env?: NodeJS.ProcessEnv
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
  inspect?: (options?: { homeRoot?: string; waitMs?: number }) => Promise<RuntimeSummary>
  start?: (options: Record<string, unknown>) => Promise<unknown>
  stop?: (options: Record<string, unknown>) => Promise<unknown>
  open?: (options: Record<string, unknown>) => Promise<unknown>
  readLogs?: (options: Record<string, unknown>) => Promise<RuntimeLogs>
  diagnose?: (options: Record<string, unknown>) => Promise<DoctorReport>
  checkUpdate?: () => Promise<UpdateResult>
  discoverUpdate?: () => Promise<UpdateResult | null>
  resolveContext?: (
    flags: TuiLaunchFlags,
  ) => ResolvedLaunchContext | Promise<ResolvedLaunchContext>
  findSource?: (startPath: string) => Promise<string>
  configureSource?: (
    context: ResolvedLaunchContext,
    appDir: string,
  ) => Promise<ResolvedLaunchContext>
  prepareManagedSource?: () => Promise<ManagedSourceResult>
  inspectManagedSource?: () => Promise<ManagedSourcePlan>
  machineConfig?: MachineSupervisorConfig | null
  instanceConfig?: InstanceLaunchConfig | null
  loadTui?: typeof loadPiTui
  version?: string
  channel?: string
  pollIntervalMs?: number
  resolveChannel?: () => Promise<string>
}

interface SupervisorServices {
  inspect: NonNullable<SupervisorTuiDependencies['inspect']>
  start: NonNullable<SupervisorTuiDependencies['start']>
  stop: NonNullable<SupervisorTuiDependencies['stop']>
  open: NonNullable<SupervisorTuiDependencies['open']>
  readLogs: NonNullable<SupervisorTuiDependencies['readLogs']>
  diagnose: NonNullable<SupervisorTuiDependencies['diagnose']>
  checkUpdate: NonNullable<SupervisorTuiDependencies['checkUpdate']>
  discoverUpdate: NonNullable<SupervisorTuiDependencies['discoverUpdate']>
}

export async function runSupervisorTui(
  launchFlags: TuiLaunchFlags = {},
  dependencies: SupervisorTuiDependencies = {},
): Promise<number> {
  const stdin = dependencies.stdin ?? process.stdin
  const stdout = dependencies.stdout ?? process.stdout
  if (!stdin.isTTY || !stdout.isTTY) {
    throw Object.assign(
      new Error('the Supervisor TUI requires an interactive terminal; use "openalice status --json" for automation'),
      { code: 'ETTY', exitCode: 2 },
    )
  }

  let context = await (
    dependencies.resolveContext
    ?? ((flags) => {
      if (dependencies.machineConfig || dependencies.instanceConfig) {
        return resolveLaunchContext({
          flags,
          env: dependencies.env,
          machineConfig: dependencies.machineConfig,
          instanceConfig: dependencies.instanceConfig,
        })
      }
      return resolveStoredLaunchContext(flags, { env: dependencies.env })
    })
  )(launchFlags)
  let services = createServices(dependencies, context)
  let runtime: RuntimeSummary | null = null
  let diagnostic: string | undefined
  try {
    runtime = await services.inspect({ homeRoot: context.home, waitMs: 2_000 })
  } catch (error: unknown) {
    diagnostic = safeError(error)
  }

  const piTui = await (dependencies.loadTui ?? loadPiTui)(dependencies.env)
  const channel = dependencies.channel
    ?? await (dependencies.resolveChannel ?? resolveSupervisorChannel)()
  const terminal = new piTui.ProcessTerminal()
  const ui = new piTui.TUI(
    terminal,
    undefined,
    join(context.supervisorRoot, 'logs'),
  )
  let active = true
  let actionRunning = false
  let sourcePromptActive = false
  let closeSourcePrompt: (() => void) | null = null
  const screen = new SupervisorScreen({
    version: dependencies.version ?? readCliVersion(),
    channel,
    runtime,
    context,
    diagnostic,
  }, {
    onAction: (action) => {
      void requestAction(action)
    },
    onConfigureSource: () => {
      openSourcePrompt()
    },
    onRequestManagedSource: () => {
      void requestManagedSource()
    },
    onPrepareManagedSource: () => {
      void prepareManagedSourceAndStart()
    },
    requestRender: () => ui.requestRender(),
  })
  ui.addChild(screen)

  const findSource = dependencies.findSource ?? findOpenAliceRoot
  const configureSource = dependencies.configureSource ?? (async (
    currentContext,
    appDir,
  ) => {
    await persistInstanceLaunchConfig(currentContext, { appDir })
    return resolveStoredLaunchContext(launchFlags, {
      env: dependencies.env,
    })
  })
  const prepareManaged = dependencies.prepareManagedSource
    ?? (() => prepareManagedSource())
  const inspectManaged = dependencies.inspectManagedSource
    ?? (() => inspectManagedSource())

  async function refreshRuntime(): Promise<void> {
    if (!active || actionRunning) return
    try {
      const nextRuntime = await services.inspect({
        homeRoot: context.home,
        waitMs: 1_000,
      })
      if (!active) return
      screen.update({ runtime: nextRuntime, diagnostic: undefined })
    } catch (error: unknown) {
      if (!active) return
      screen.update({ diagnostic: safeError(error) })
    }
  }

  async function requestAction(action: SupervisorAction): Promise<void> {
    if (
      action === 'start'
      && context.appDir === null
    ) {
      try {
        await findSource(process.cwd())
      } catch (error: unknown) {
        openSourcePrompt(safeError(error))
        return
      }
    }
    await performAction(action)
  }

  async function performAction(action: SupervisorAction): Promise<void> {
    if (!active || actionRunning) return
    actionRunning = true
    let actionFailure: string | undefined
    const homeRoot = context.home
    const actionLabel = actionName(action)
    screen.update({ busy: actionLabel, notice: undefined, diagnostic: undefined })
    try {
      if (action === 'start') {
        await services.start({
          prepare: true,
          rebuild: false,
          checkUpdates: context.updateChecks,
          port: context.port,
          homeRoot,
          appDir: context.appDir ?? screen.snapshot.runtime?.provider?.root,
          waitMs: 120_000,
          takeover: false,
        })
        screen.update({ notice: 'Runtime started.' })
      } else if (action === 'open') {
        await services.open({ homeRoot, waitMs: 2_000 })
        screen.update({ notice: 'Opened the verified Web UI.' })
      } else if (action === 'stop') {
        await services.stop({ homeRoot, waitMs: 15_000 })
        screen.update({ notice: 'Runtime stopped.', confirmation: undefined })
      } else if (action === 'restart') {
        const appDir = screen.snapshot.runtime?.owner?.launchRoot
          ?? screen.snapshot.runtime?.provider?.root
        await services.stop({ homeRoot, waitMs: 15_000 })
        screen.update({ busy: 'Starting Runtime', confirmation: undefined })
        await services.start({
          prepare: true,
          rebuild: false,
          checkUpdates: context.updateChecks,
          port: context.port,
          homeRoot,
          appDir,
          waitMs: 120_000,
          takeover: false,
        })
        screen.update({ notice: 'Runtime restarted and reconnected.' })
      } else if (action === 'logs') {
        const logs = await services.readLogs({ homeRoot, lines: 200 })
        screen.update({ panel: 'logs', logs, notice: undefined })
      } else if (action === 'doctor') {
        const doctor = await services.diagnose({ homeRoot, waitMs: 2_000 })
        screen.update({ panel: 'doctor', doctor, notice: undefined })
      } else {
        const update = await services.checkUpdate()
        screen.update({ update, notice: formatUpdateNotice(update) })
      }
    } catch (error: unknown) {
      actionFailure = `${actionLabel} failed: ${safeError(error)}`
      screen.update({ confirmation: undefined })
    } finally {
      actionRunning = false
      if (active) {
        screen.update({ busy: undefined })
        await refreshRuntime()
        if (actionFailure) screen.update({ diagnostic: actionFailure })
      }
    }
  }

  async function requestManagedSource(): Promise<void> {
    if (actionRunning) return
    const source = context.provenance.appDir.source
    if (source === 'environment' || source === 'cli-flag') {
      screen.update({
        notice: `Source is locked by ${context.provenance.appDir.detail}; change that override and reopen the Supervisor.`,
      })
      return
    }
    actionRunning = true
    screen.update({
      busy: 'Inspecting managed source',
      notice: undefined,
      diagnostic: undefined,
    })
    try {
      const managedSource = await inspectManaged()
      if (!active) return
      screen.update({
        managedSource,
        confirmation: 'managed-source',
      })
    } catch (error: unknown) {
      if (!active) return
      screen.update({
        diagnostic: `Managed source is unavailable: ${safeError(error)}`,
      })
    } finally {
      actionRunning = false
      if (active) screen.update({ busy: undefined })
    }
  }

  async function prepareManagedSourceAndStart(): Promise<void> {
    if (!active || actionRunning) return
    actionRunning = true
    let prepared = false
    let actionFailure: string | undefined
    screen.update({
      busy: 'Preparing managed source',
      confirmation: undefined,
      notice: undefined,
      diagnostic: undefined,
    })
    try {
      const result = await prepareManaged()
      const nextContext = await configureSource(context, result.appDir)
      context = nextContext
      services = createServices(dependencies, context)
      prepared = true
      screen.update({
        context,
        notice: result.created
          ? `Prepared and saved managed source ${result.appDir}.`
          : `Reused and saved managed source ${result.appDir}.`,
      })
    } catch (error: unknown) {
      actionFailure = `Preparing managed source failed: ${safeError(error)}`
    } finally {
      actionRunning = false
      if (active) {
        screen.update({ busy: undefined })
        await refreshRuntime()
        if (actionFailure) screen.update({ diagnostic: actionFailure })
      }
    }
    if (prepared && active) await performAction('start')
  }

  function openSourcePrompt(reason?: string): void {
    if (sourcePromptActive || actionRunning) return
    const source = context.provenance.appDir.source
    if (source === 'environment' || source === 'cli-flag') {
      screen.update({
        notice: `Source is locked by ${context.provenance.appDir.detail}; change that override and reopen the Supervisor.`,
      })
      return
    }

    sourcePromptActive = true
    let saving = false
    const input = new (class extends piTui.Input {
      detail = reason
        ? `Start needs an OpenAlice source checkout. ${reason}`
        : 'Choose the OpenAlice source checkout for this instance.'

      setDetail(detail: string): void {
        this.detail = detail
        this.invalidate()
        ui.requestRender()
      }

      override render(width: number): string[] {
        return [
          'Configure Runtime source',
          '',
          sanitize(this.detail),
          '',
          ...super.render(width),
          '',
          'Enter  Save for this instance and start',
          'Esc    Cancel',
        ]
      }
    })()
    input.setValue(context.appDir ?? process.cwd())
    input.handleInput('\u0005')
    const overlay = ui.showOverlay(input, {
      width: '80%',
      maxHeight: 10,
      anchor: 'center',
      margin: 1,
    })
    ui.setShowHardwareCursor(true)

    const close = (notice?: string) => {
      if (!sourcePromptActive) return
      sourcePromptActive = false
      closeSourcePrompt = null
      overlay.hide()
      ui.setShowHardwareCursor(false)
      if (notice) screen.update({ notice })
    }
    closeSourcePrompt = () => close('Source configuration cancelled.')
    input.onEscape = closeSourcePrompt
    input.onSubmit = (value) => {
      if (saving) return
      const requested = value.trim()
      if (!requested) {
        input.setDetail('Enter a source checkout path.')
        return
      }
      saving = true
      input.setDetail('Validating and saving the source checkout…')
      void (async () => {
        try {
          const appDir = await findSource(requested)
          const nextContext = await configureSource(context, appDir)
          context = nextContext
          services = createServices(dependencies, context)
          screen.update({
            context,
            diagnostic: undefined,
            notice: `Saved source checkout ${appDir}.`,
          })
          close()
          await performAction('start')
        } catch (error: unknown) {
          input.setDetail(`Could not use that checkout: ${safeError(error)}`)
        } finally {
          saving = false
        }
      })()
    }
    overlay.focus()
  }

  async function discoverUpdateInBackground(): Promise<void> {
    if (!context.updateChecks) return
    try {
      const update = await services.discoverUpdate()
      if (!update) return
      if (!active) return
      screen.update({
        update,
        ...(update.status === 'available' ? { notice: formatUpdateNotice(update) } : {}),
      })
    } catch {
      // Update discovery is advisory and must not disturb lifecycle control.
    }
  }

  return new Promise<number>((resolve) => {
    let settled = false
    const poll = setInterval(
      () => void refreshRuntime(),
      dependencies.pollIntervalMs ?? 1_500,
    )
    poll.unref()

    const finish = (code = 0) => {
      if (settled) return
      settled = true
      active = false
      clearInterval(poll)
      closeSourcePrompt?.()
      removeInputListener()
      process.off('SIGTERM', onTerminate)
      process.off('SIGINT', onTerminate)
      ui.stop()
      resolve(code)
    }
    const onTerminate = () => finish()
    const removeInputListener = ui.addInputListener((data) => {
      if (sourcePromptActive) {
        if (piTui.matchesKey(data, 'ctrl+c')) {
          finish()
          return { consume: true }
        }
        return undefined
      }
      if (screen.snapshot.confirmation && piTui.matchesKey(data, 'escape')) {
        screen.cancelConfirmation()
        return { consume: true }
      }
      if (
        piTui.matchesKey(data, 'q')
        || piTui.matchesKey(data, 'escape')
        || piTui.matchesKey(data, 'ctrl+c')
      ) {
        finish()
        return { consume: true }
      }
      return screen.handleKey(data, piTui.matchesKey)
        ? { consume: true }
        : undefined
    })

    process.once('SIGTERM', onTerminate)
    process.once('SIGINT', onTerminate)
    ui.start()
    void discoverUpdateInBackground()
  })
}

export async function resolveSupervisorChannel(
  options: {
    moduleUrl?: string
    resolveLayout?: (moduleUrl?: string) => unknown
    readSource?: () => Promise<{
      selector?: { kind?: string; value?: string }
    }>
  } = {},
): Promise<string> {
  const moduleUrl = options.moduleUrl ?? import.meta.url
  const layout = (
    options.resolveLayout ?? resolveInstalledLayout
  )(moduleUrl)
  if (!layout) return 'development'
  const source = await (options.readSource ?? readInstallSource)()
  if (source.selector?.kind === 'version') return 'stable'
  return source.selector?.value
    ? `branch ${source.selector.value}`
    : 'installed'
}

export class SupervisorScreen implements Component {
  snapshot: SupervisorSnapshot
  private readonly onAction?: (action: SupervisorAction) => void
  private readonly onConfigureSource?: () => void
  private readonly onRequestManagedSource?: () => void
  private readonly onPrepareManagedSource?: () => void
  private readonly requestRender?: () => void

  constructor(
    snapshot: SupervisorSnapshot,
    callbacks: {
      onAction?: (action: SupervisorAction) => void
      onConfigureSource?: () => void
      onRequestManagedSource?: () => void
      onPrepareManagedSource?: () => void
      requestRender?: () => void
    } = {},
  ) {
    this.snapshot = { panel: 'overview', ...snapshot }
    this.onAction = callbacks.onAction
    this.onConfigureSource = callbacks.onConfigureSource
    this.onRequestManagedSource = callbacks.onRequestManagedSource
    this.onPrepareManagedSource = callbacks.onPrepareManagedSource
    this.requestRender = callbacks.requestRender
  }

  update(patch: Partial<SupervisorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.requestRender?.()
  }

  cancelConfirmation(): void {
    this.update({ confirmation: undefined, notice: 'Action cancelled.' })
  }

  handleKey(
    data: string,
    matchesKey: (data: string, key: KeyId) => boolean,
  ): boolean {
    if (this.snapshot.busy) return false
    if (this.snapshot.confirmation) {
      if (matchesKey(data, 'y') || matchesKey(data, 'enter')) {
        if (this.snapshot.confirmation === 'managed-source') {
          this.onPrepareManagedSource?.()
        } else {
          this.onAction?.(this.snapshot.confirmation)
        }
        return true
      }
      if (matchesKey(data, 'n')) {
        this.cancelConfirmation()
        return true
      }
      return false
    }
    if (matchesKey(data, '?')) {
      this.update({ panel: this.snapshot.panel === 'help' ? 'overview' : 'help' })
      return true
    }
    if (matchesKey(data, 'tab') || matchesKey(data, 'right')) {
      this.selectAdjacentPanel(1)
      return true
    }
    if (matchesKey(data, 'c')) {
      if (this.snapshot.runtime?.class === 'absent') {
        this.onConfigureSource?.()
      } else {
        this.update({
          notice: 'Stop the selected Runtime before changing its source checkout.',
        })
      }
      return true
    }
    if (matchesKey(data, 'm')) {
      if (this.snapshot.runtime?.class === 'absent') {
        this.onRequestManagedSource?.()
      } else {
        this.update({
          notice: 'Stop the selected Runtime before changing its source checkout.',
        })
      }
      return true
    }
    if (matchesKey(data, 'shift+tab') || matchesKey(data, 'left')) {
      this.selectAdjacentPanel(-1)
      return true
    }
    const keyActions: Array<[KeyId, SupervisorAction]> = [
      ['s', 'start'],
      ['o', 'open'],
      ['l', 'logs'],
      ['d', 'doctor'],
      ['u', 'update'],
    ]
    for (const [key, action] of keyActions) {
      if (matchesKey(data, key)) {
        if (this.actionAvailable(action)) this.onAction?.(action)
        else this.update({ notice: unavailableActionMessage(action, this.snapshot.runtime) })
        return true
      }
    }
    if (matchesKey(data, 'x') || matchesKey(data, 'r')) {
      const action = matchesKey(data, 'x') ? 'stop' : 'restart'
      if (!this.actionAvailable(action)) {
        this.update({ notice: unavailableActionMessage(action, this.snapshot.runtime) })
      } else {
        this.update({ confirmation: action })
      }
      return true
    }
    return false
  }

  render(width: number): string[] {
    const runtime = this.snapshot.runtime
    const narrow = width < 60
    const state = runtime?.class ?? 'unavailable'
    const updateBadge = this.snapshot.update?.status === 'available'
      ? ` · update ${this.snapshot.update.latestVersion ?? 'available'}`
      : ''
    const lines = [
      `OpenAlice  ${this.snapshot.version}  ${this.snapshot.channel}${updateBadge}`,
      '─'.repeat(Math.max(1, Math.min(width, 80))),
      renderTabs(this.snapshot.panel ?? 'overview', narrow),
      '',
    ]

    if (this.snapshot.panel === 'logs') {
      lines.push(...renderLogs(this.snapshot.logs))
    } else if (this.snapshot.panel === 'doctor') {
      lines.push(...renderDoctor(this.snapshot.doctor))
    } else if (this.snapshot.panel === 'help') {
      lines.push(...renderHelp())
    } else {
      lines.push(
        narrow ? `Runtime: ${state}` : `Runtime state: ${state}`,
        `Instance: ${this.snapshot.context?.instance ?? 'default'}`,
        `Home: ${this.snapshot.context?.home ?? runtime?.home ?? 'default'}`,
      )
      if (!narrow) {
        lines.push(
          `Owner: ${formatOwner(runtime)}`,
          `Web: ${runtime?.endpoints?.web ?? 'not available'}`,
          `Components: ${formatComponents(runtime)}`,
        )
        if (runtime?.provider?.kind) {
          lines.push(`Provider: ${runtime.provider.kind}`)
        }
        if (Number.isInteger(runtime?.uptimeSeconds)) {
          lines.push(`Uptime: ${formatDuration(runtime?.uptimeSeconds ?? 0)}`)
        }
        if (this.snapshot.context) {
          lines.push(`Resolved: home ${formatProvenance(this.snapshot.context.provenance.home)} · port ${formatProvenance(this.snapshot.context.provenance.port)}`)
          lines.push(`Source: ${this.snapshot.context.appDir ?? runtime?.provider?.root ?? 'current directory discovery'} ${formatProvenance(this.snapshot.context.provenance.appDir)}`)
        }
      }
      lines.push('', ...renderGuidance(runtime))
    }

    if (this.snapshot.confirmation) {
      lines.push('', ...renderConfirmation(
        this.snapshot.confirmation,
        runtime,
        this.snapshot.managedSource,
      ))
    }
    if (this.snapshot.busy) lines.push('', `Working: ${this.snapshot.busy}…`)
    if (this.snapshot.notice) lines.push('', `Notice: ${sanitize(this.snapshot.notice)}`)
    if (this.snapshot.diagnostic) {
      lines.push('', `Diagnostic: ${sanitize(this.snapshot.diagnostic)}`)
    }
    lines.push(
      '',
      actionBar(runtime, narrow),
      'q / Esc / Ctrl+C  Detach without stopping',
    )
    return lines.map((line) => truncate(line, width))
  }

  invalidate(): void {}

  private actionAvailable(action: SupervisorAction): boolean {
    const runtime = this.snapshot.runtime
    if (action === 'logs' || action === 'doctor' || action === 'update') return true
    if (action === 'start') return runtime?.class === 'absent'
    if (action === 'open') return Boolean(runtime?.endpoints?.web)
    return runtime?.owner?.surface === 'cli-server'
      && runtime.class !== 'absent'
      && runtime.class !== 'incompatible'
  }

  private selectAdjacentPanel(direction: 1 | -1): void {
    const panels: SupervisorPanel[] = ['overview', 'logs', 'doctor', 'help']
    const current = panels.indexOf(this.snapshot.panel ?? 'overview')
    const panel = panels[(current + direction + panels.length) % panels.length]
    this.update({ panel })
    if (panel === 'logs') this.onAction?.('logs')
    if (panel === 'doctor') this.onAction?.('doctor')
  }
}

function createServices(
  dependencies: SupervisorTuiDependencies,
  context: ResolvedLaunchContext,
): SupervisorServices {
  const shared = {
    env: buildManagedPiEnv(context, dependencies.env ?? process.env),
  }
  return {
    inspect: dependencies.inspect ?? ((options) => inspectRuntime(options, shared)),
    start: dependencies.start ?? ((options) => startRuntime(options, {
      ...shared,
      detached: true,
    })),
    stop: dependencies.stop ?? ((options) => stopRuntime(options, shared)),
    open: dependencies.open ?? ((options) => openRuntime(options, shared)),
    readLogs: dependencies.readLogs ?? ((options) => readRuntimeLogs(options, shared)),
    diagnose: dependencies.diagnose ?? ((options) => diagnoseRuntime(options, shared)),
    checkUpdate: dependencies.checkUpdate ?? (() => checkForUpdate({}, shared)),
    discoverUpdate: dependencies.discoverUpdate ?? (() => maybeNotifyUpdate(
      { enabled: true },
      { ...shared, interactive: true, stderr: SILENT_OUTPUT },
    )),
  }
}

function renderTabs(selected: SupervisorPanel, narrow: boolean): string {
  const labels: Array<[SupervisorPanel, string]> = [
    ['overview', narrow ? 'Home' : 'Overview'],
    ['logs', 'Logs'],
    ['doctor', 'Doctor'],
    ['help', 'Help'],
  ]
  return labels
    .map(([panel, label]) => panel === selected ? `[${label}]` : label)
    .join('  ')
}

function renderGuidance(runtime: RuntimeSummary | null): string[] {
  if (!runtime) return ['Runtime status is unavailable. Doctor may explain why.']
  if (runtime.class === 'absent') {
    return ['OpenAlice is stopped. Press s to start, m for managed source, or c for an existing checkout.']
  }
  if (runtime.class === 'incompatible') {
    return ['The running Guardian is incompatible. Read Doctor before changing it.']
  }
  if (runtime.class === 'running') {
    return ['Runtime is ready. Press o to hand product interaction to the Web UI.']
  }
  return [`Runtime is ${runtime.class ?? runtime.state ?? 'unknown'}; status will refresh automatically.`]
}

function renderLogs(logs: RuntimeLogs | null | undefined): string[] {
  if (!logs) return ['Press l to load the bounded, redacted Runtime log tail.']
  const entries = logs.entries ?? []
  if (entries.length === 0) return ['No Runtime log entries were found.']
  const lines = ['Runtime logs (bounded and redacted):', '']
  lines.push(...entries.slice(-16).map((entry) => sanitize(entry.text ?? '')))
  if (logs.truncated || entries.length > 16) {
    lines.push('[showing the most recent visible lines]')
  }
  return lines
}

function renderDoctor(doctor: DoctorReport | null | undefined): string[] {
  if (!doctor) return ['Press d to run read-only Runtime diagnostics.']
  const summary = doctor.summary
  const lines = [
    `Doctor: ${doctor.overall ?? 'unknown'} · ${summary?.passed ?? 0} pass · ${summary?.warnings ?? 0} warn · ${summary?.failures ?? 0} fail`,
    '',
  ]
  for (const check of (doctor.checks ?? []).slice(0, 12)) {
    lines.push(`[${(check.status ?? 'unknown').toUpperCase()}] ${sanitize(check.summary ?? '')}`)
    if (check.detail) lines.push(`  ${sanitize(check.detail)}`)
  }
  return lines
}

function renderHelp(): string[] {
  return [
    'Supervisor controls',
    '',
    's  Start persistent Runtime       o  Open verified Web UI',
    'x  Stop (confirmation required)   r  Restart (confirmation required)',
    'l  Bounded redacted logs          d  Read-only Doctor',
    'u  Check for product update       ?  Toggle this help',
    'm  Prepare installer-managed source and start',
    'c  Choose and remember this instance\'s source checkout',
    'Tab / arrows  Change panel        q / Esc  Detach only',
    '',
    'The Supervisor manages Runtime state. Workspaces, trading, and chat stay in the Web UI.',
  ]
}

function renderConfirmation(
  action: 'stop' | 'restart' | 'managed-source',
  runtime: RuntimeSummary | null,
  managedSource?: ManagedSourcePlan | null,
): string[] {
  if (action === 'managed-source') {
    const selector = managedSource
      ? `${managedSource.selector.kind} ${managedSource.selector.value}`
      : 'the branch/version paired with this CLI'
    return [
      `Prepare and use installer-managed OpenAlice source ${selector}?`,
      `Destination: ${managedSource?.appDir ?? 'the OpenAlice install root'}`,
      'First start may install dependencies and build the Runtime.',
      'Press y / Enter to continue, n / Esc to cancel.',
    ]
  }
  const effect = action === 'stop'
    ? 'This stops the Guardian-owned Runtime and disconnects active Web/agent sessions.'
    : 'This stops and starts the Guardian-owned Runtime; active Web/agent sessions reconnect or end.'
  return [
    `${action === 'stop' ? 'Stop' : 'Restart'} Runtime owned by ${formatOwner(runtime)}?`,
    effect,
    'Press y / Enter to continue, n / Esc to cancel.',
  ]
}

function actionBar(runtime: RuntimeSummary | null, narrow: boolean): string {
  const actions = runtime?.class === 'absent'
    ? 's Start · m Managed · c Source · d Doctor · l Logs · u Update · ? Help'
    : 'o Open · r Restart · x Stop · d Doctor · l Logs · u Update · ? Help'
  return narrow ? actions.replaceAll(' · ', '  ') : actions
}

function unavailableActionMessage(
  action: SupervisorAction,
  runtime: RuntimeSummary | null,
): string {
  if (action === 'start') return 'Start is available only when the selected Runtime is stopped.'
  if (action === 'open') return 'The selected Runtime has not advertised a verified Web endpoint.'
  if (action === 'stop' || action === 'restart') {
    return runtime?.owner
      ? `Refusing to ${action}: ${runtime.owner.surface ?? 'another owner'} owns this Runtime.`
      : `Refusing to ${action}: no CLI-owned Runtime is active.`
  }
  return `${actionName(action)} is not available in the current state.`
}

function actionName(action: SupervisorAction): string {
  return {
    start: 'Starting Runtime',
    open: 'Opening Web UI',
    stop: 'Stopping Runtime',
    restart: 'Restarting Runtime',
    logs: 'Loading logs',
    doctor: 'Running Doctor',
    update: 'Checking for updates',
  }[action]
}

function formatUpdateNotice(update: UpdateResult): string {
  if (update.status === 'available') {
    return `OpenAlice ${update.latestVersion ?? 'update'} is available; use "openalice update" to review installation.`
  }
  if (update.status === 'current') {
    return `OpenAlice ${update.currentVersion ?? ''} is current.`.trim()
  }
  return update.message ?? 'Automatic update is unavailable for this install channel.'
}

function formatOwner(runtime: RuntimeSummary | null): string {
  if (!runtime?.owner) return 'none'
  const pid = runtime.owner.pid === undefined ? '' : ` pid ${runtime.owner.pid}`
  return `${runtime.owner.surface ?? 'unknown'}${pid}`
}

function formatComponents(runtime: RuntimeSummary | null): string {
  const components = runtime?.components
  if (!components) return 'not reported'
  return [
    `Alice ${components.alice ?? 'unknown'}`,
    `UTA ${components.uta ?? 'optional'}`,
    `Connector ${components.connector ?? 'optional'}`,
  ].join(' · ')
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3_600)}h ${Math.floor((seconds % 3_600) / 60)}m`
}

function formatProvenance(value: { source: string; detail: string }): string {
  return value.source === 'default' ? '(default)' : `(${value.detail})`
}

function safeError(error: unknown): string {
  return sanitize(error instanceof Error ? error.message : String(error))
}

function sanitize(value: string): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function truncate(value: string, width: number): string {
  if (width <= 0) return ''
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

function readCliVersion(): string {
  const packageUrl = new URL('../package.json', import.meta.url)
  const manifest = JSON.parse(readFileSync(packageUrl, 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : 'unknown'
}
