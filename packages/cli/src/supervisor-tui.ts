import { readFileSync } from 'node:fs'
import {
  dirname,
  join,
} from 'node:path'
import type {
  Component,
  KeyId,
  SelectItem,
  SelectListTheme,
  SettingItem,
  SettingsListTheme,
} from '@earendil-works/pi-tui'

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
  type LaunchConfigValues,
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
  createSupervisorInstance,
  persistInstanceLaunchConfig,
  persistMachineLaunchConfig,
  persistSelectedSupervisorInstance,
  readInstanceLaunchConfig,
  readMachineLaunchConfig,
  readSupervisorInstanceRegistry,
  isStoredHomeUnavailableError,
  resolveAvailableStoredLaunchContext,
  resolveStoredLaunchContext,
  validateSupervisorInstanceName,
  type SupervisorInstanceRegistry,
} from './supervisor-config.ts'
import {
  checkForUpdate,
  maybeNotifyUpdate,
} from './update.mjs'

const SILENT_OUTPUT = Object.freeze({ write: () => true })
const INHERIT_SETTING = 'Inherit'
const ENABLED_SETTING = 'Enabled'
const DISABLED_SETTING = 'Disabled'
const INSTANCE_SCOPE = 'This instance'
const MACHINE_SCOPE = 'Machine defaults'

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
  | 'start-open'
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
  configureInstance?: (
    context: ResolvedLaunchContext,
    patch: LaunchConfigValues,
  ) => Promise<ResolvedLaunchContext>
  configureMachine?: (
    context: ResolvedLaunchContext,
    patch: LaunchConfigValues,
  ) => Promise<ResolvedLaunchContext>
  loadInstanceConfig?: (
    context: ResolvedLaunchContext,
  ) => Promise<InstanceLaunchConfig>
  loadMachineConfig?: (
    context: ResolvedLaunchContext,
  ) => Promise<LaunchConfigValues>
  loadInstanceRegistry?: (
    context: ResolvedLaunchContext,
  ) => Promise<SupervisorInstanceRegistry>
  selectInstance?: (
    context: ResolvedLaunchContext,
    name: string,
  ) => Promise<ResolvedLaunchContext>
  createInstance?: (
    context: ResolvedLaunchContext,
    name: string,
    home: string,
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

  const resolveContext = dependencies.resolveContext
    ?? ((flags: TuiLaunchFlags) => {
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
  let context: ResolvedLaunchContext
  let startupNotice: string | undefined
  try {
    context = await resolveContext(launchFlags)
  } catch (error: unknown) {
    const env = dependencies.env ?? process.env
    const explicitSelection = launchFlags.instance !== undefined
      || launchFlags.home !== undefined
      || env['OPENALICE_INSTANCE'] !== undefined
      || env['OPENALICE_HOME'] !== undefined
    const customResolution = dependencies.resolveContext !== undefined
      || dependencies.machineConfig !== undefined
      || dependencies.instanceConfig !== undefined
    if (
      explicitSelection
      || customResolution
      || !isStoredHomeUnavailableError(error)
    ) {
      throw error
    }
    context = await resolveAvailableStoredLaunchContext({
      env: dependencies.env,
    })
    startupNotice = storedHomeRecoveryNotice(error, context.instance)
  }
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
  let settingsActive = false
  let instancesActive = false
  let managedStartAction: 'start' | 'start-open' = 'start'
  let closeSourcePrompt: (() => void) | null = null
  let closeSettings: (() => void) | null = null
  let closeInstances: (() => void) | null = null
  const screen = new SupervisorScreen({
    version: dependencies.version ?? readCliVersion(),
    channel,
    runtime,
    context,
    diagnostic,
    notice: startupNotice,
  }, {
    onAction: (action) => {
      void requestAction(action)
    },
    onConfigureSource: () => {
      openSourcePrompt()
    },
    onSettings: () => {
      void openSettings()
    },
    onInstances: () => {
      void openInstances()
    },
    onRequestManagedSource: () => {
      void requestManagedSource('start')
    },
    onPrepareManagedSource: () => {
      void prepareManagedSourceAndStart()
    },
    requestRender: () => ui.requestRender(),
  })
  ui.addChild(screen)

  const findSource = dependencies.findSource ?? findOpenAliceRoot
  const configureInstance = dependencies.configureInstance ?? (async (
    currentContext,
    patch,
  ) => {
    await persistInstanceLaunchConfig(currentContext, patch)
    return resolveStoredLaunchContext(launchFlags, {
      env: dependencies.env,
    })
  })
  const loadInstanceConfig = dependencies.loadInstanceConfig
    ?? readInstanceLaunchConfig
  const loadMachineConfig = dependencies.loadMachineConfig
    ?? readMachineLaunchConfig
  const configureMachine = dependencies.configureMachine ?? (async (
    currentContext,
    patch,
  ) => {
    await persistMachineLaunchConfig(currentContext, patch)
    return resolveStoredLaunchContext(launchFlags, {
      env: dependencies.env,
    })
  })
  const loadInstanceRegistry = dependencies.loadInstanceRegistry
    ?? readSupervisorInstanceRegistry
  const selectInstance = dependencies.selectInstance ?? (async (
    currentContext,
    name,
  ) => {
    await persistSelectedSupervisorInstance(currentContext, name)
    return resolveStoredLaunchContext(launchFlags, {
      env: dependencies.env,
    })
  })
  const createInstance = dependencies.createInstance ?? (async (
    currentContext,
    name,
    home,
  ) => {
    await createSupervisorInstance(currentContext, name, home)
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
      (action === 'start' || action === 'start-open')
      && context.appDir === null
    ) {
      try {
        await findSource(process.cwd())
      } catch (error: unknown) {
        await requestManagedSource(action, safeError(error))
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
      if (action === 'start' || action === 'start-open') {
        await services.start({
          prepare: true,
          rebuild: false,
          checkUpdates: context.updateChecks,
          runtimeProvider: context.runtimeProvider,
          port: runtimeStartPort(context),
          homeRoot,
          appDir: context.appDir ?? screen.snapshot.runtime?.provider?.root,
          waitMs: 120_000,
          takeover: false,
        })
        if (action === 'start-open') {
          screen.update({ notice: 'Runtime started.' })
          try {
            await services.open({ homeRoot, waitMs: 2_000 })
            screen.update({
              notice: 'OpenAlice started and opened in your browser.',
            })
          } catch (error: unknown) {
            actionFailure = `OpenAlice is running, but the browser did not open: ${safeError(error)}`
          }
        } else {
          screen.update({ notice: 'Runtime started in the background.' })
        }
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
          runtimeProvider: context.runtimeProvider,
          port: runtimeStartPort(context),
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

  async function requestManagedSource(
    startAction: 'start' | 'start-open',
    sourceFailure?: string,
  ): Promise<void> {
    if (actionRunning) return
    const source = context.provenance.appDir.source
    if (source === 'environment' || source === 'cli-flag') {
      screen.update({
        notice: `Source is locked by ${context.provenance.appDir.detail}; change that override and reopen the Supervisor.`,
      })
      return
    }
    actionRunning = true
    let sourceFallback: string | undefined
    screen.update({
      busy: 'Inspecting managed source',
      notice: undefined,
      diagnostic: undefined,
    })
    try {
      const managedSource = await inspectManaged()
      if (!active) return
      managedStartAction = startAction
      screen.update({
        managedSource,
        confirmation: 'managed-source',
      })
    } catch (error: unknown) {
      if (!active) return
      if (sourceFailure) {
        sourceFallback = [
          sourceFailure,
          `Automatic Runtime setup is unavailable: ${safeError(error)}`,
        ].join(' ')
      } else {
        screen.update({
          diagnostic: `Managed source is unavailable: ${safeError(error)}`,
        })
      }
    } finally {
      actionRunning = false
      if (active) screen.update({ busy: undefined })
    }
    if (sourceFallback) openSourcePrompt(sourceFallback)
  }

  async function prepareManagedSourceAndStart(): Promise<void> {
    if (!active || actionRunning) return
    const startAction = managedStartAction
    managedStartAction = 'start'
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
      const nextContext = await configureInstance(context, {
        appDir: result.appDir,
      })
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
    if (prepared && active) await performAction(startAction)
  }

  function openSourcePrompt(reason?: string): void {
    if (
      sourcePromptActive
      || settingsActive
      || instancesActive
      || actionRunning
    ) return
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
          const nextContext = await configureInstance(context, { appDir })
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

  async function openSettings(): Promise<void> {
    if (
      settingsActive
      || sourcePromptActive
      || instancesActive
      || actionRunning
    ) return
    actionRunning = true
    screen.update({
      busy: 'Loading instance settings',
      notice: undefined,
      diagnostic: undefined,
    })
    let storedInstance: InstanceLaunchConfig
    let storedMachine: LaunchConfigValues
    try {
      ;[storedInstance, storedMachine] = await Promise.all([
        loadInstanceConfig(context),
        loadMachineConfig(context),
      ])
    } catch (error: unknown) {
      screen.update({
        diagnostic: `Could not load instance settings: ${safeError(error)}`,
      })
      return
    } finally {
      actionRunning = false
      if (active) screen.update({ busy: undefined })
    }
    if (!active) return

    settingsActive = true
    let saving = false
    let scope: typeof INSTANCE_SCOPE | typeof MACHINE_SCOPE = INSTANCE_SCOPE
    let message = 'Changes apply to this instance. Env vars and command options remain locked.'
    const items: SettingItem[] = []
    let settings: InstanceType<typeof piTui.SettingsList>

    const setMessage = (next: string) => {
      message = next
      ui.requestRender()
    }
    const close = (notice = 'Setup closed.') => {
      if (!settingsActive) return
      settingsActive = false
      closeSettings = null
      overlay.hide()
      ui.setShowHardwareCursor(false)
      screen.update({ notice })
    }
    const inputSubmenu = (
      title: string,
      initialValue: string,
      validate: (value: string) => string | undefined,
      done: (selectedValue?: string) => void,
      initialDetail = 'Leave blank to inherit from the next lower-priority layer.',
    ): Component => {
      const input = new (class extends piTui.Input {
        detail = initialDetail

        setDetail(next: string): void {
          this.detail = next
          this.invalidate()
          ui.requestRender()
        }

        override render(width: number): string[] {
          return [
            title,
            '',
            ...super.render(width),
            '',
            sanitize(this.detail),
            '',
            'Enter  Save · Esc  Cancel',
          ]
        }
      })()
      input.setValue(initialValue)
      input.focused = true
      ui.setShowHardwareCursor(true)
      input.onEscape = () => {
        input.focused = false
        ui.setShowHardwareCursor(false)
        done()
      }
      input.onSubmit = (value) => {
        const validation = validate(value.trim())
        if (validation) {
          input.setDetail(validation)
          return
        }
        input.focused = false
        ui.setShowHardwareCursor(false)
        done(value.trim() || INHERIT_SETTING)
      }
      return input
    }

    const syncItems = () => {
      const stored = scope === INSTANCE_SCOPE ? storedInstance : storedMachine
      const editingMachine = scope === MACHINE_SCOPE
      const runtimeStopped = screen.snapshot.runtime?.class === 'absent'
      const homeLocked = editingMachine
        ? undefined
        : settingOverrideLock(context.provenance.home)
      const portLocked = editingMachine
        ? undefined
        : settingOverrideLock(context.provenance.port)
      const updatesLocked = editingMachine
        ? undefined
        : settingOverrideLock(context.provenance.updateChecks)
      const homeAffectsRunning = !editingMachine
        || machineDefaultAffectsCurrent('home', context)
      const portAffectsRunning = !editingMachine
        || machineDefaultAffectsCurrent('port', context)
      const homeEditable = !homeLocked
        && (runtimeStopped || !homeAffectsRunning)
      const portEditable = !portLocked
        && (runtimeStopped || !portAffectsRunning)
      const layerDescription = editingMachine
        ? 'Default for instances that do not set their own value.'
        : `Overrides machine defaults for instance "${context.instance}".`
      const homeItem: SettingItem = {
        id: 'home',
        label: 'Data home',
        currentValue: homeLocked
          ? `${context.home} · locked`
          : editingMachine
            ? machineHomeSettingValue(stored.home)
            : inheritedSettingValue(stored.home, context.home),
        description: homeLocked
          ?? (
            homeEditable
              ? (
                  editingMachine
                    ? 'Default data home for the implicit "default" instance. Blank uses ~/.openalice.'
                    : context.instance === 'default'
                    ? 'Where this instance keeps settings, credentials, and local state. Blank uses the inherited location.'
                    : 'Where this named instance keeps its separate settings, credentials, and local state.'
                )
              : 'Stop OpenAlice before changing the data-home layer used by this running instance.'
          ),
      }
      if (homeEditable) {
        homeItem.submenu = (_currentValue, done) => inputSubmenu(
          editingMachine ? 'Set machine-default data home' : 'Set instance data home',
          stored.home ?? '',
          (value) => (
            !editingMachine && context.instance !== 'default' && value === ''
              ? 'Named instances require an explicit data home.'
              : undefined
          ),
          done,
          editingMachine || context.instance === 'default'
            ? 'Leave blank to inherit from the next lower-priority layer.'
            : 'Named instances require a separate data home.',
        )
      }
      const portItem: SettingItem = {
        id: 'port',
        label: 'Browser port',
        currentValue: portLocked
          ? `${context.port} · locked`
          : editingMachine
            ? machinePortSettingValue(stored.port)
            : portSettingValue(stored.port, context),
        description: portLocked
          ?? (
            portEditable
              ? `${layerDescription} Blank chooses an available port automatically.`
              : 'Stop OpenAlice before changing the browser-port layer used by this running instance.'
          ),
      }
      if (portEditable) {
        portItem.submenu = (_currentValue, done) => inputSubmenu(
          editingMachine ? 'Set machine-default browser port' : 'Set instance browser port',
          stored.port?.toString() ?? '',
          validatePortSetting,
          done,
        )
      }
      const updateItem: SettingItem = {
        id: 'updateChecks',
        label: 'Update checks',
        currentValue: updatesLocked
          ? `${context.updateChecks ? ENABLED_SETTING : DISABLED_SETTING} · locked`
          : editingMachine
            ? machineBooleanSettingValue(stored.updateChecks)
            : booleanSettingValue(stored.updateChecks),
        description: updatesLocked
          ?? `${layerDescription} Current instance resolves to ${context.updateChecks ? 'enabled' : 'disabled'}.`,
      }
      if (!updatesLocked) {
        updateItem.values = [
          INHERIT_SETTING,
          ENABLED_SETTING,
          DISABLED_SETTING,
        ]
      }
      const runtimeItem: SettingItem = context.runtimeProvider.kind === 'bundle'
        ? {
            id: 'source',
            label: 'Installed Runtime',
            currentValue: `OpenAlice ${screen.snapshot.version} · ${context.runtimeProvider.contentIdentity ?? 'verified'}`,
            description: `Managed by the installer at ${context.appDir ?? 'an unavailable path'}. No source checkout is needed.`,
          }
        : {
            id: 'source',
            label: 'Source checkout',
            currentValue: context.appDir ?? 'current directory discovery',
            description: 'Advanced development provider. Use m for managed source or c to choose a checkout.',
          }
      items.splice(0, items.length,
        {
          id: 'scope',
          label: 'Editing',
          currentValue: scope,
          values: [INSTANCE_SCOPE, MACHINE_SCOPE],
          description: editingMachine
            ? 'Machine defaults are inherited by instances without their own value.'
            : 'Instance values override machine defaults. Env vars and command options remain higher priority.',
        },
        homeItem,
        portItem,
        updateItem,
        runtimeItem,
        {
          id: 'config',
          label: 'Advanced config',
          currentValue: join(context.supervisorRoot, 'config.json'),
          description: 'Read-only location for machine defaults and named-instance settings.',
        },
      )
    }
    syncItems()
    const updateDisplayedValues = () => {
      for (const item of items) {
        settings.updateValue(item.id, item.currentValue)
      }
    }
    const restoreDisplayedValue = (id: string) => {
      syncItems()
      const item = items.find((candidate) => candidate.id === id)
      if (item) settings.updateValue(id, item.currentValue)
    }

    const applySetting = async (
      id: string,
      newValue: string,
    ): Promise<void> => {
      if (saving) return
      if (id === 'scope') {
        scope = newValue === MACHINE_SCOPE ? MACHINE_SCOPE : INSTANCE_SCOPE
        syncItems()
        updateDisplayedValues()
        setMessage(
          scope === MACHINE_SCOPE
            ? 'Editing machine defaults. Instance, env, and command layers remain above them.'
            : `Editing instance "${context.instance}". Env and command layers remain above it.`,
        )
        return
      }
      const field = settingField(id)
      if (!field) return
      const editingMachine = scope === MACHINE_SCOPE
      const lock = editingMachine
        ? undefined
        : settingOverrideLock(context.provenance[field])
      if (lock) {
        setMessage(lock)
        restoreDisplayedValue(id)
        return
      }
      if (
        (field === 'home' || field === 'port')
        && screen.snapshot.runtime?.class !== 'absent'
        && (
          !editingMachine
          || machineDefaultAffectsCurrent(field, context)
        )
      ) {
        setMessage(`Stop OpenAlice before changing its ${field === 'home' ? 'data home' : 'browser port'}.`)
        restoreDisplayedValue(id)
        return
      }

      const patch: LaunchConfigValues = field === 'home'
        ? { home: newValue === INHERIT_SETTING ? undefined : newValue }
        : field === 'port'
          ? {
              port: newValue === INHERIT_SETTING
                ? undefined
                : Number.parseInt(newValue, 10),
            }
          : {
              updateChecks: newValue === INHERIT_SETTING
                ? undefined
                : newValue === ENABLED_SETTING,
            }
      saving = true
      actionRunning = true
      const layerLabel = editingMachine ? 'machine default' : `instance "${context.instance}"`
      setMessage(`Saving ${settingLabel(field)} for ${layerLabel}…`)
      try {
        context = editingMachine
          ? await configureMachine(context, patch)
          : await configureInstance(context, patch)
        services = createServices(dependencies, context)
        ;[storedInstance, storedMachine] = await Promise.all([
          loadInstanceConfig(context),
          loadMachineConfig(context),
        ])
        syncItems()
        updateDisplayedValues()
        screen.update({
          context,
          diagnostic: undefined,
        })
        setMessage(`Saved ${settingLabel(field)} for ${layerLabel}.`)
      } catch (error: unknown) {
        restoreDisplayedValue(id)
        setMessage(`Could not save ${settingLabel(field)}: ${safeError(error)}`)
      } finally {
        actionRunning = false
        saving = false
        await refreshRuntime()
      }
    }

    const theme: SettingsListTheme = {
      label: (text) => text,
      value: (text) => text,
      description: (text) => text,
      cursor: '> ',
      hint: (text) => text,
    }
    settings = new piTui.SettingsList(
      items,
      6,
      theme,
      (id, newValue) => {
        void applySetting(id, newValue)
      },
      () => close(),
    )
    const panel = new (class implements Component {
      render(width: number): string[] {
        return [
          `OpenAlice setup · ${context.instance}`,
          '─'.repeat(Math.max(1, width)),
          '',
          ...settings.render(width),
          '',
          sanitize(message),
        ]
      }

      handleInput(data: string): void {
        if (!saving) settings.handleInput(data)
      }

      invalidate(): void {
        settings.invalidate()
      }
    })()
    const overlay = ui.showOverlay(panel, {
      width: '90%',
      maxHeight: '90%',
      anchor: 'center',
      margin: 1,
    })
    closeSettings = () => close()
    overlay.focus()
  }

  async function openInstances(): Promise<void> {
    if (
      instancesActive
      || sourcePromptActive
      || settingsActive
      || actionRunning
    ) return
    actionRunning = true
    screen.update({
      busy: 'Loading instances',
      notice: undefined,
      diagnostic: undefined,
    })
    let registry: SupervisorInstanceRegistry
    try {
      registry = await loadInstanceRegistry(context)
    } catch (error: unknown) {
      screen.update({
        diagnostic: `Could not load instances: ${safeError(error)}`,
      })
      return
    } finally {
      actionRunning = false
      if (active) screen.update({ busy: undefined })
    }
    if (!active) return

    instancesActive = true
    let changing = false
    let message = 'Selecting an instance also makes it the next bare-start default.'
    const lock = instanceSelectionOverrideLock(context)
    if (lock) message = lock
    const createValue = '__create_instance__'
    const visibleInstances = registry.instances.some(
      (entry) => entry.name === context.instance,
    )
      ? registry.instances
      : [
          ...registry.instances,
          {
            name: context.instance,
            home: context.home,
            port: context.port,
            portAutomatic: context.provenance.port.source === 'default',
            isDefault: false,
          },
        ]
    const items: SelectItem[] = visibleInstances.map((entry) => ({
      value: entry.name,
      label: [
        entry.name,
        entry.name === context.instance ? 'current' : undefined,
        entry.isDefault ? 'default' : undefined,
      ].filter(Boolean).join(' · '),
      description: `${entry.home} · Web ${entry.portAutomatic ? `auto from ${entry.port}` : entry.port}`,
    }))
    if (!lock) {
      items.push({
        value: createValue,
        label: '+ Create instance…',
        description: 'Register a separate data home and select it.',
      })
    }

    const theme: SelectListTheme = {
      selectedPrefix: (text) => text,
      selectedText: (text) => text,
      description: (text) => text,
      scrollInfo: (text) => text,
      noMatch: (text) => text,
    }
    const list = new piTui.SelectList(items, 8, theme, {
      minPrimaryColumnWidth: 20,
      maxPrimaryColumnWidth: 32,
    })
    const selectedIndex = items.findIndex(
      (item) => item.value === context.instance,
    )
    list.setSelectedIndex(Math.max(0, selectedIndex))
    let component: Component = list

    const setMessage = (next: string) => {
      message = next
      ui.requestRender()
    }
    const close = (notice = 'Instance selection closed.') => {
      if (!instancesActive) return
      instancesActive = false
      closeInstances = null
      overlay.hide()
      ui.setShowHardwareCursor(false)
      screen.update({ notice })
    }
    const showList = () => {
      ui.setShowHardwareCursor(false)
      component = list
      setMessage(lock ?? 'Selecting an instance also makes it the next bare-start default.')
    }
    const activateContext = async (
      operation: () => Promise<ResolvedLaunchContext>,
      notice: (next: ResolvedLaunchContext) => string,
    ) => {
      if (changing) return
      changing = true
      actionRunning = true
      setMessage('Switching instance…')
      try {
        const next = await operation()
        context = next
        services = createServices(dependencies, context)
        screen.update({
          context,
          runtime: null,
          diagnostic: undefined,
        })
        close(notice(next))
      } catch (error: unknown) {
        setMessage(`Could not switch instance: ${safeError(error)}`)
      } finally {
        actionRunning = false
        changing = false
        await refreshRuntime()
      }
    }
    const showCreateHomeInput = (name: string) => {
      const defaultHome = registry.instances.find(
        (entry) => entry.name === 'default',
      )?.home ?? context.home
      const suggestedHome = join(
        dirname(defaultHome),
        `.openalice-${name}`,
      )
      const input = new (class extends piTui.Input {
        detail = 'Use a separate data home. An empty directory is prepared when registered.'

        setDetail(next: string): void {
          this.detail = next
          this.invalidate()
          ui.requestRender()
        }

        override render(width: number): string[] {
          return [
            `Create instance · ${name}`,
            '',
            'Data home',
            ...super.render(width),
            '',
            sanitize(this.detail),
            '',
            'Enter  Create and select · Esc  Back',
          ]
        }
      })()
      input.setValue(suggestedHome)
      input.focused = true
      ui.setShowHardwareCursor(true)
      input.onEscape = () => {
        input.focused = false
        showList()
      }
      input.onSubmit = (value) => {
        const home = value.trim()
        if (!home) {
          input.setDetail('Enter a data home for this instance.')
          return
        }
        void activateContext(
          () => createInstance(context, name, home),
          (next) => `Created and selected instance ${next.instance}.`,
        )
      }
      component = input
      setMessage('The new instance owns only its registry entry; its data is never copied or deleted.')
    }
    const showCreateNameInput = () => {
      const input = new (class extends piTui.Input {
        detail = 'Use a short lowercase name such as research or paper.'

        setDetail(next: string): void {
          this.detail = next
          this.invalidate()
          ui.requestRender()
        }

        override render(width: number): string[] {
          return [
            'Create instance',
            '',
            'Instance name',
            ...super.render(width),
            '',
            sanitize(this.detail),
            '',
            'Enter  Continue · Esc  Back',
          ]
        }
      })()
      input.focused = true
      ui.setShowHardwareCursor(true)
      input.onEscape = () => {
        input.focused = false
        showList()
      }
      input.onSubmit = (value) => {
        const name = value.trim()
        const validation = validateSupervisorInstanceName(name)
        if (validation) {
          input.setDetail(validation)
          return
        }
        if (registry.instances.some((entry) => entry.name === name)) {
          input.setDetail(`Instance "${name}" is already registered.`)
          return
        }
        input.focused = false
        showCreateHomeInput(name)
      }
      component = input
      setMessage('Create a named instance without leaving the Supervisor.')
    }

    list.onCancel = () => close()
    list.onSelect = (item) => {
      if (item.value === createValue) {
        showCreateNameInput()
        return
      }
      if (lock) {
        setMessage(lock)
        return
      }
      if (
        item.value === context.instance
        && item.value === registry.defaultInstance
      ) {
        close(`Instance ${context.instance} is already selected.`)
        return
      }
      void activateContext(
        () => selectInstance(context, item.value),
        (next) => `Selected instance ${next.instance}; future bare starts use it.`,
      )
    }

    const panel = new (class implements Component {
      render(width: number): string[] {
        return [
          'OpenAlice instances',
          '─'.repeat(Math.max(1, width)),
          '',
          ...component.render(width),
          '',
          sanitize(message),
        ]
      }

      handleInput(data: string): void {
        if (!changing) component.handleInput?.(data)
      }

      invalidate(): void {
        component.invalidate()
      }
    })()
    const overlay = ui.showOverlay(panel, {
      width: '92%',
      maxHeight: '90%',
      anchor: 'center',
      margin: 1,
    })
    closeInstances = () => close()
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
      closeSettings?.()
      closeInstances?.()
      removeInputListener()
      process.off('SIGTERM', onTerminate)
      process.off('SIGINT', onTerminate)
      ui.stop()
      resolve(code)
    }
    const onTerminate = () => finish()
    const removeInputListener = ui.addInputListener((data) => {
      if (sourcePromptActive || settingsActive || instancesActive) {
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
  private readonly onSettings?: () => void
  private readonly onInstances?: () => void
  private readonly onRequestManagedSource?: () => void
  private readonly onPrepareManagedSource?: () => void
  private readonly requestRender?: () => void

  constructor(
    snapshot: SupervisorSnapshot,
    callbacks: {
      onAction?: (action: SupervisorAction) => void
      onConfigureSource?: () => void
      onSettings?: () => void
      onInstances?: () => void
      onRequestManagedSource?: () => void
      onPrepareManagedSource?: () => void
      requestRender?: () => void
    } = {},
  ) {
    this.snapshot = { panel: 'overview', ...snapshot }
    this.onAction = callbacks.onAction
    this.onConfigureSource = callbacks.onConfigureSource
    this.onSettings = callbacks.onSettings
    this.onInstances = callbacks.onInstances
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
    if (matchesKey(data, 'enter')) {
      const action = primaryAction(this.snapshot.runtime)
      if (action && this.actionAvailable(action)) {
        this.onAction?.(action)
      } else {
        this.update({
          notice: 'No primary action is available in the current Runtime state.',
        })
      }
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
    if (matchesKey(data, 'p')) {
      this.onSettings?.()
      return true
    }
    if (matchesKey(data, 'i')) {
      this.onInstances?.()
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
        const reportedProvider = runtime?.provider?.kind
        const provider = reportedProvider && reportedProvider !== 'unknown'
          ? reportedProvider
          : this.snapshot.context?.runtimeProvider.kind
        if (provider) {
          lines.push(`Provider: ${provider}${runtime?.class === 'absent' && provider === 'bundle' ? ' (installed)' : ''}`)
        }
        if (Number.isInteger(runtime?.uptimeSeconds)) {
          lines.push(`Uptime: ${formatDuration(runtime?.uptimeSeconds ?? 0)}`)
        }
        if (this.snapshot.context) {
          lines.push(`Resolved: home ${formatProvenance(this.snapshot.context.provenance.home)} · port ${formatPortResolution(this.snapshot.context)}`)
          if (this.snapshot.context.runtimeProvider.kind === 'bundle') {
            lines.push(
              `Runtime: OpenAlice ${this.snapshot.version} · bundle ${this.snapshot.context.runtimeProvider.contentIdentity ?? 'verified'}`,
            )
          } else {
            lines.push(`Source: ${this.snapshot.context.appDir ?? runtime?.provider?.root ?? 'current directory discovery'} ${formatProvenance(this.snapshot.context.provenance.appDir)}`)
          }
        }
      }
      lines.push('', ...renderGuidance(runtime, this.snapshot.context))
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
      ...actionBar(runtime, this.snapshot.context, width),
      'q / Esc / Ctrl+C  Detach without stopping',
    )
    return lines.map((line) => truncate(line, width))
  }

  invalidate(): void {}

  private actionAvailable(action: SupervisorAction): boolean {
    const runtime = this.snapshot.runtime
    if (action === 'logs' || action === 'doctor' || action === 'update') return true
    if (action === 'start' || action === 'start-open') {
      return runtime?.class === 'absent'
    }
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

function renderGuidance(
  runtime: RuntimeSummary | null,
  context?: ResolvedLaunchContext,
): string[] {
  if (!runtime) return ['Runtime status is unavailable. Doctor may explain why.']
  if (runtime.class === 'absent') {
    if (context?.runtimeProvider.kind === 'bundle') {
      return [
        'OpenAlice is ready to start.',
        'Press Enter to start and open the browser, or p to review setup first.',
      ]
    }
    return [
      'OpenAlice is ready to start.',
      'Enter prepares anything missing and opens the browser; c chooses a checkout.',
    ]
  }
  if (runtime.class === 'incompatible') {
    return ['The running Guardian is incompatible. Read Doctor before changing it.']
  }
  if (runtime.class === 'running') {
    return ['OpenAlice is ready. Press Enter or o to open the Web UI.']
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
    'Enter  Start and open / open Web UI',
    's  Start in background            o  Open verified Web UI',
    'x  Stop (confirmation required)   r  Restart (confirmation required)',
    'l  Bounded redacted logs          d  Read-only Doctor',
    'u  Check for product update       ?  Toggle this help',
    'i  Select or create an instance',
    'p  Review setup for this instance',
    'm  Advanced: prepare installer-managed source and start',
    'c  Advanced: choose and remember a source checkout',
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

function actionBar(
  runtime: RuntimeSummary | null,
  context: ResolvedLaunchContext | undefined,
  width: number,
): string[] {
  const primary = runtime?.class === 'absent'
    ? context?.runtimeProvider.kind === 'bundle'
      ? 'Enter Start & open · s Background · p Setup · i Instances'
      : 'Enter Start & open · s Background · p Setup · i Instances · m Managed · c Source'
    : 'Enter / o Open · i Instances · p Setup · r Restart · x Stop'
  const secondary = 'd Doctor · l Logs · u Update · ? Help'
  const actions = `${primary} · ${secondary}`
  if (actions.length <= width) return [actions]
  if (width < 60) {
    return [
      primary.replaceAll(' · ', '  '),
      secondary.replaceAll(' · ', '  '),
    ]
  }
  return [primary, secondary]
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
    'start-open': 'Starting and opening OpenAlice',
    open: 'Opening Web UI',
    stop: 'Stopping Runtime',
    restart: 'Restarting Runtime',
    logs: 'Loading logs',
    doctor: 'Running Doctor',
    update: 'Checking for updates',
  }[action]
}

function primaryAction(
  runtime: RuntimeSummary | null,
): SupervisorAction | undefined {
  if (runtime?.class === 'absent') return 'start-open'
  if (runtime?.endpoints?.web) return 'open'
  return undefined
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

function runtimeStartPort(
  context: ResolvedLaunchContext,
): number | undefined {
  return context.provenance.port.source === 'default'
    ? undefined
    : context.port
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

function formatPortResolution(context: ResolvedLaunchContext): string {
  return context.provenance.port.source === 'default'
    ? `(automatic from ${context.port})`
    : formatProvenance(context.provenance.port)
}

type EditableSettingField = 'home' | 'port' | 'updateChecks'

function settingField(id: string): EditableSettingField | undefined {
  if (id === 'home' || id === 'port' || id === 'updateChecks') return id
  return undefined
}

function settingLabel(field: EditableSettingField): string {
  return {
    home: 'data home',
    port: 'browser port',
    updateChecks: 'update checks',
  }[field]
}

function settingOverrideLock(
  provenance: { source: string; detail: string },
): string | undefined {
  if (
    provenance.source !== 'environment'
    && provenance.source !== 'cli-flag'
  ) {
    return undefined
  }
  return `Locked by ${provenance.detail}. Change that higher-priority override and reopen the Supervisor.`
}

function instanceSelectionOverrideLock(
  context: ResolvedLaunchContext,
): string | undefined {
  const instanceLock = settingOverrideLock(context.provenance.instance)
  if (instanceLock) return `Instance selection is read-only. ${instanceLock}`
  const homeLock = settingOverrideLock(context.provenance.home)
  if (homeLock) {
    return `Instance selection is read-only while this session's data home is fixed. ${homeLock}`
  }
  return undefined
}

function inheritedSettingValue(
  stored: string | number | undefined,
  resolved: string | number,
): string {
  return stored === undefined
    ? `${INHERIT_SETTING} → ${resolved}`
    : String(stored)
}

function portSettingValue(
  stored: number | undefined,
  context: ResolvedLaunchContext,
): string {
  if (stored !== undefined) return String(stored)
  return context.provenance.port.source === 'default'
    ? `${INHERIT_SETTING} → automatic from ${context.port}`
    : `${INHERIT_SETTING} → ${context.port}`
}

function booleanSettingValue(stored: boolean | undefined): string {
  if (stored === undefined) return INHERIT_SETTING
  return stored ? ENABLED_SETTING : DISABLED_SETTING
}

function machineHomeSettingValue(stored: string | undefined): string {
  return stored ?? `${INHERIT_SETTING} → ~/.openalice`
}

function machinePortSettingValue(stored: number | undefined): string {
  return stored?.toString()
    ?? `${INHERIT_SETTING} → automatic from 47331`
}

function machineBooleanSettingValue(stored: boolean | undefined): string {
  return stored === undefined
    ? INHERIT_SETTING
    : stored ? ENABLED_SETTING : DISABLED_SETTING
}

function machineDefaultAffectsCurrent(
  field: 'home' | 'port',
  context: ResolvedLaunchContext,
): boolean {
  return context.provenance[field].source === 'default'
    || context.provenance[field].source === 'machine-config'
}

function validatePortSetting(value: string): string | undefined {
  if (!value) return undefined
  if (!/^\d+$/.test(value)) {
    return 'Browser port must be a whole number from 1 to 65535.'
  }
  const port = Number(value)
  return port >= 1 && port <= 65_535
    ? undefined
    : 'Browser port must be a whole number from 1 to 65535.'
}

function safeError(error: unknown): string {
  return sanitize(error instanceof Error ? error.message : String(error))
}

function storedHomeRecoveryNotice(
  error: unknown,
  fallbackInstance: string,
): string {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/for instance "([^"]+)" (is missing|is unavailable or not writable)/)
  const unavailable = match
    ? `Instance "${match[1]}" ${match[2]}.`
    : 'The remembered instance home is unavailable.'
  return sanitize(
    `${unavailable} Using "${fallbackInstance}"; press i Instances to recover.`,
  )
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
