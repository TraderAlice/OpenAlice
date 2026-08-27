import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  dirname,
  join,
  posix,
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
  inspectMachineFleet,
  seedMachineFleet,
  type MachineFleetEnvelope,
  type MachineInventory,
  type MachineProjectInventory,
} from './machine-inventory.ts'
import {
  readMachineRegistrySummary,
  type MachineRegistrySummary,
  type RegisteredMachine,
} from './machine-registry.ts'
import {
  inspectRuntime,
  openRuntime,
  startRuntime,
  stopRuntime,
} from './lifecycle.mjs'
import {
  buildManagedPiEnv,
  buildAliceProjectEnv,
  resolveLaunchContext,
  resolveSupervisorRootPath,
  type AliceProjectLaunchConfig,
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
import { connectSsh } from './ssh-connect.mjs'
import { buildRemoteSshArgs } from './remote.mjs'
import { planProjectTransfer, type ProjectTransferPlan } from './project-transfer.ts'
import { transferProjectOverSsh } from './project-transfer-ssh.ts'
import type { ProjectTransferReceipt } from './project-transfer-stream.ts'
import {
  createSupervisorFleetState,
  fleetTunnelKey,
  moveFleetSelection,
  renderSupervisorFleet,
  replaceFleetInventory,
  selectedFleetMachine,
  selectedFleetProject,
  selectFleetProjectByKey,
  setFleetFocus,
  type SupervisorFleetState,
} from './supervisor-fleet.ts'
import {
  createSupervisorTransferWizard,
  renderTransferPlanReview,
  renderTransferResult,
  selectTransferDestination,
  selectedTransferDestination,
} from './supervisor-transfer.ts'
import {
  createSupervisorAliceProject,
  persistAliceProjectLaunchConfig,
  persistMachineLaunchConfig,
  persistSelectedSupervisorAliceProject,
  readAliceProjectLaunchConfig,
  readMachineLaunchConfig,
  readSupervisorAliceProjectRegistry,
  isNewerSupervisorSchemaError,
  isStoredHomeUnavailableError,
  isSupervisorConfigError,
  resolveAvailableStoredLaunchContext,
  resolveStoredLaunchContext,
  validateSupervisorAliceProjectKey,
  type SupervisorAliceProjectRegistry,
} from './supervisor-config.ts'
import {
  checkForUpdate,
  downloadAndRunInstaller,
  maybeNotifyUpdate,
} from './update.mjs'

const SILENT_OUTPUT = Object.freeze({ write: () => true })
const INHERIT_SETTING = 'Inherit'
const ENABLED_SETTING = 'Enabled'
const DISABLED_SETTING = 'Disabled'
const PROJECT_SCOPE = 'This AliceProject'
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
  releaseNotesUrl?: string
  installer?: {
    url?: string
    versionedUrl?: string
    sha256?: string
  }
}

export type SupervisorPanel = 'fleet' | 'overview' | 'logs' | 'doctor' | 'help'
export type SupervisorMode = 'normal' | 'config-recovery'
export type SupervisorConfigRecoveryReason = 'newer-schema' | 'unreadable'
export type SupervisorAction =
  | 'start'
  | 'start-open'
  | 'open'
  | 'stop'
  | 'restart'
  | 'logs'
  | 'doctor'
  | 'update'
  | 'apply-update'
export type SupervisorConfirmation =
  | 'stop'
  | 'restart'
  | 'managed-source'
  | 'update'

export interface SupervisorSnapshot {
  version: string
  channel: string
  runtime: RuntimeSummary | null
  context?: ResolvedLaunchContext
  mode?: SupervisorMode
  recoveryReason?: SupervisorConfigRecoveryReason
  diagnostic?: string
  panel?: SupervisorPanel
  busy?: string
  notice?: string
  confirmation?: SupervisorConfirmation
  logs?: RuntimeLogs | null
  doctor?: DoctorReport | null
  update?: UpdateResult | null
  managedSource?: ManagedSourcePlan | null
  fleet?: SupervisorFleetState | null
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
  applyUpdate?: (result: UpdateResult) => Promise<number>
  resolveContext?: (
    flags: TuiLaunchFlags,
  ) => ResolvedLaunchContext | Promise<ResolvedLaunchContext>
  findSource?: (startPath: string) => Promise<string>
  configureProject?: (
    context: ResolvedLaunchContext,
    patch: LaunchConfigValues,
  ) => Promise<ResolvedLaunchContext>
  configureMachine?: (
    context: ResolvedLaunchContext,
    patch: LaunchConfigValues,
  ) => Promise<ResolvedLaunchContext>
  loadProjectConfig?: (
    context: ResolvedLaunchContext,
  ) => Promise<AliceProjectLaunchConfig>
  loadMachineConfig?: (
    context: ResolvedLaunchContext,
  ) => Promise<LaunchConfigValues>
  loadProjectRegistry?: (
    context: ResolvedLaunchContext,
  ) => Promise<SupervisorAliceProjectRegistry>
  selectProject?: (
    context: ResolvedLaunchContext,
    name: string,
  ) => Promise<ResolvedLaunchContext>
  createProject?: (
    context: ResolvedLaunchContext,
    name: string,
    home: string,
  ) => Promise<ResolvedLaunchContext>
  prepareManagedSource?: () => Promise<ManagedSourceResult>
  inspectManagedSource?: () => Promise<ManagedSourcePlan>
  machineConfig?: MachineSupervisorConfig | null
  projectConfig?: AliceProjectLaunchConfig | null
  loadTui?: typeof loadPiTui
  version?: string
  channel?: string
  pollIntervalMs?: number
  seedFleet?: () => Promise<MachineFleetEnvelope>
  inspectFleet?: () => Promise<MachineFleetEnvelope>
  loadMachineRegistry?: () => Promise<MachineRegistrySummary>
  connectRemoteProject?: (input: {
    machine: MachineInventory
    project: MachineProjectInventory
    signal: AbortSignal
    onReady: () => void
  }) => Promise<number>
  planProjectTransfer?: typeof planProjectTransfer
  sendProjectTransfer?: (input: {
    machine: RegisteredMachine
    plan: ProjectTransferPlan
    signal?: AbortSignal
    onProgress?: (progress: { files: number; bytes: number; totalFiles: number; totalBytes: number }) => void
  }) => Promise<ProjectTransferReceipt>
  inspectTransferSource?: (home: string) => Promise<RuntimeSummary>
  startRemoteProject?: (machine: RegisteredMachine, projectKey: string) => Promise<void>
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
  applyUpdate: NonNullable<SupervisorTuiDependencies['applyUpdate']>
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
      if (dependencies.machineConfig || dependencies.projectConfig) {
        return resolveLaunchContext({
          flags,
          env: dependencies.env,
          machineConfig: dependencies.machineConfig,
          projectConfig: dependencies.projectConfig,
        })
      }
      return resolveStoredLaunchContext(flags, { env: dependencies.env })
    })
  let context: ResolvedLaunchContext | undefined
  let startupNotice: string | undefined
  let configRecovery = false
  let recoveryReason: SupervisorConfigRecoveryReason | undefined
  let diagnosticFromConfig: string | undefined
  try {
    context = await resolveContext(launchFlags)
  } catch (error: unknown) {
    const env = dependencies.env ?? process.env
    const explicitSelection = hasExplicitProjectOrHomeSelection(launchFlags, env)
    const explicitCliSelection = hasExplicitProjectOrHomeFlags(launchFlags)
    const customResolution = dependencies.resolveContext !== undefined
      || dependencies.machineConfig !== undefined
      || dependencies.projectConfig !== undefined
    if (isStoredHomeUnavailableError(error)) {
      if (explicitSelection || customResolution) throw error
      context = await resolveAvailableStoredLaunchContext({
        env: dependencies.env,
      })
      startupNotice = storedHomeRecoveryNotice(error, context.project)
    } else if (isSupervisorConfigError(error)) {
      if (explicitCliSelection) throw error
      configRecovery = true
      recoveryReason = isNewerSupervisorSchemaError(error)
        ? 'newer-schema'
        : 'unreadable'
      startupNotice = configRecoveryNotice(error)
      diagnosticFromConfig = safeError(error)
    } else {
      throw error
    }
  }
  let services = createServices(dependencies, context, { configRecovery })
  let runtime: RuntimeSummary | null = null
  let diagnostic: string | undefined = diagnosticFromConfig
  if (!configRecovery && context) {
    try {
      runtime = await services.inspect({ homeRoot: context.home, waitMs: 2_000 })
    } catch (error: unknown) {
      diagnostic = safeError(error)
    }
  }

  const supervisorRoot = context?.supervisorRoot
    ?? resolveSupervisorRootPath({ env: dependencies.env })
  let fleet: SupervisorFleetState | null = null
  if (!configRecovery) {
    try {
      const seeded = await (dependencies.seedFleet ?? (() => seedMachineFleet({
        env: dependencies.env,
        supervisorRoot,
        inspectRuntime: (options) => services.inspect(options),
        loadMachineRegistry: dependencies.loadMachineRegistry,
      })))()
      fleet = createSupervisorFleetState(
        seeded.generatedAt,
        alignLocalFleetProject(seeded.machines, context, runtime),
        context?.project,
      )
    } catch (error: unknown) {
      diagnostic = diagnostic ?? safeError(error)
    }
  }
  const piTui = await (dependencies.loadTui ?? loadPiTui)(dependencies.env)
  const channel = dependencies.channel
    ?? await (dependencies.resolveChannel ?? resolveSupervisorChannel)()
  const terminal = new piTui.ProcessTerminal()
  const ui = new piTui.TUI(
    terminal,
    undefined,
    join(supervisorRoot, 'logs'),
  )
  let active = true
  let actionRunning = false
  let sourcePromptActive = false
  let settingsActive = false
  let projectsActive = false
  let transferActive = false
  let fleetRefreshing = false
  const tunnelControllers = new Map<string, AbortController>()
  let managedStartAction: 'start' | 'start-open' = 'start'
  let closeSourcePrompt: (() => void) | null = null
  let closeSettings: (() => void) | null = null
  let closeProjects: (() => void) | null = null
  let closeTransfer: (() => void) | null = null
  const screen = new SupervisorScreen({
    version: dependencies.version ?? readCliVersion(),
    channel,
    runtime,
    context,
    mode: configRecovery ? 'config-recovery' : 'normal',
    recoveryReason,
    diagnostic,
    notice: startupNotice,
    fleet,
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
    onProjects: () => {
      void openProjects()
    },
    onActivateFleet: (machine, project) => {
      void activateFleetProject(machine, project)
    },
    onStartFleet: (machine, project) => {
      void startFleetProject(machine, project)
    },
    onRefreshFleet: () => {
      void refreshFleet()
    },
    onTransferFleet: (source) => {
      void openTransferWizard(source)
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
  const configureProject = dependencies.configureProject ?? (async (
    currentContext,
    patch,
  ) => {
    await persistAliceProjectLaunchConfig(currentContext, patch)
    return resolveStoredLaunchContext(launchFlags, {
      env: dependencies.env,
    })
  })
  const loadProjectConfig = dependencies.loadProjectConfig
    ?? readAliceProjectLaunchConfig
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
  const loadProjectRegistry = dependencies.loadProjectRegistry
    ?? readSupervisorAliceProjectRegistry
  const selectProject = dependencies.selectProject ?? (async (
    currentContext,
    name,
  ) => {
    await persistSelectedSupervisorAliceProject(currentContext, name)
    return resolveStoredLaunchContext(launchFlags, {
      env: dependencies.env,
    })
  })
  const createProject = dependencies.createProject ?? (async (
    currentContext,
    name,
    home,
  ) => {
    await createSupervisorAliceProject(currentContext, name, home)
    return resolveStoredLaunchContext(launchFlags, {
      env: dependencies.env,
    })
  })
  const prepareManaged = dependencies.prepareManagedSource
    ?? (() => prepareManagedSource())
  const inspectManaged = dependencies.inspectManagedSource
    ?? (() => inspectManagedSource())
  const loadMachines = dependencies.loadMachineRegistry
    ?? (() => readMachineRegistrySummary({
      env: dependencies.env,
      supervisorRoot,
    }))
  const inspectFleet = dependencies.inspectFleet ?? (() => inspectMachineFleet({
    env: dependencies.env,
    supervisorRoot,
    inspectRuntime: (options) => services.inspect(options),
    loadMachineRegistry: loadMachines,
  }))
  const connectRemoteProject = dependencies.connectRemoteProject ?? (async ({
    machine,
    project,
    signal,
    onReady,
  }) => {
    const registry = await loadMachines()
    const target = registry.machines.find((entry) => entry.key === machine.key)
    if (!target) throw new Error(`Machine "${machine.key}" is no longer registered.`)
    const remotePort = loopbackEndpointPort(project.runtime.webEndpoint)
    if (remotePort === null) {
      throw new Error(`AliceProject "${project.key}" does not advertise a loopback Web endpoint.`)
    }
    return connectSsh({
      destination: target.sshTarget,
      localPort: 0,
      remotePort,
      sshPort: target.sshPort ?? null,
      identityFile: target.identityFile ?? null,
      openBrowser: true,
      waitMs: 60_000,
      signal,
      onReady,
    }, { stdout: SILENT_OUTPUT })
  })
  const planTransfer = dependencies.planProjectTransfer ?? planProjectTransfer
  const sendTransfer = dependencies.sendProjectTransfer ?? ((input) => transferProjectOverSsh(input))
  const inspectTransferSource = dependencies.inspectTransferSource
    ?? ((home) => inspectRuntime({ homeRoot: home, waitMs: 2_000 }))
  const startRemoteProject = dependencies.startRemoteProject
    ?? ((machine, projectKey) => runRemoteProjectStart(machine, projectKey))

  async function refreshRuntime(): Promise<void> {
    if (!active || actionRunning || configRecovery || !context) return
    try {
      const nextRuntime = await services.inspect({
        homeRoot: context.home,
        waitMs: 1_000,
      })
      if (!active) return
      runtime = nextRuntime
      const currentFleet = screen.snapshot.fleet
      screen.update({
        runtime: nextRuntime,
        fleet: currentFleet && context
          ? selectFleetProjectByKey(
              replaceFleetInventory(
                currentFleet,
                currentFleet.generatedAt,
                alignLocalFleetProject(
                  currentFleet.machines,
                  context,
                  nextRuntime,
                ),
              ),
              'local',
              context.project,
            )
          : currentFleet,
        diagnostic: undefined,
      })
    } catch (error: unknown) {
      if (!active) return
      screen.update({ diagnostic: safeError(error) })
    }
  }

  async function refreshFleet(options: { quiet?: boolean } = {}): Promise<void> {
    if (!active || configRecovery || fleetRefreshing) return
    fleetRefreshing = true
    if (screen.snapshot.fleet) {
      screen.update({
        fleet: { ...screen.snapshot.fleet, refreshing: true },
        ...(options.quiet ? {} : { notice: 'Refreshing Machine fleet…' }),
      })
    }
    try {
      const inspected = await inspectFleet()
      if (!active) return
      const current = screen.snapshot.fleet ?? createSupervisorFleetState(
        inspected.generatedAt,
        inspected.machines,
        context?.project,
      )
      screen.update({
        fleet: replaceFleetInventory(
          current,
          inspected.generatedAt,
          alignLocalFleetProject(inspected.machines, context, runtime),
        ),
        ...(options.quiet ? {} : { notice: 'Machine fleet refreshed.' }),
      })
    } catch (error: unknown) {
      if (active) screen.update({ diagnostic: safeError(error) })
    } finally {
      fleetRefreshing = false
      if (active && screen.snapshot.fleet?.refreshing) {
        screen.update({ fleet: { ...screen.snapshot.fleet, refreshing: false } })
      }
    }
  }

  async function activateFleetProject(
    machine: MachineInventory,
    project: MachineProjectInventory,
  ): Promise<void> {
    if (machine.key === 'local') {
      if (!context) return
      if (project.key !== context.project) {
        actionRunning = true
        screen.update({ busy: `Switching to ${project.displayName}` })
        try {
          context = await selectProject(context, project.key)
          services = createServices(dependencies, context)
          runtime = await services.inspect({ homeRoot: context.home, waitMs: 2_000 })
          screen.update({
            context,
            runtime,
            fleet: screen.snapshot.fleet
              ? selectFleetProjectByKey(
                  replaceFleetInventory(
                    screen.snapshot.fleet,
                    screen.snapshot.fleet.generatedAt,
                    alignLocalFleetProject(
                      screen.snapshot.fleet.machines,
                      context,
                      runtime,
                    ),
                  ),
                  'local',
                  context.project,
                )
              : screen.snapshot.fleet,
            notice: `Selected local AliceProject ${project.key}.`,
            diagnostic: undefined,
          })
          await refreshFleet({ quiet: true })
        } catch (error: unknown) {
          screen.update({ diagnostic: safeError(error) })
        } finally {
          actionRunning = false
          screen.update({ busy: undefined })
        }
        return
      }
      const action = primaryAction(screen.snapshot.runtime)
      if (action) await requestAction(action)
      return
    }
    if (machine.connection !== 'online') {
      screen.update({ notice: machine.issue?.message ?? 'The selected Machine is not online.' })
      return
    }
    if (!machine.capabilities.openTunnel || !project.runtime.webEndpoint) {
      screen.update({
        notice: 'This remote AliceProject is not running with an advertised Web endpoint. Start it on the remote Machine first.',
      })
      return
    }
    const key = fleetTunnelKey(machine.key, project.key)
    if (tunnelControllers.has(key)) {
      screen.update({ notice: `The ${machine.key}/${project.key} tunnel is already active.` })
      return
    }
    const controller = new AbortController()
    tunnelControllers.set(key, controller)
    updateTunnelState(key, 'connecting')
    screen.update({ notice: `Connecting to ${machine.displayName} / ${project.displayName}…` })
    try {
      await connectRemoteProject({
        machine,
        project,
        signal: controller.signal,
        onReady: () => {
          updateTunnelState(key, 'connected')
          screen.update({ notice: `Connected to ${machine.displayName} / ${project.displayName}.` })
        },
      })
      if (active && !controller.signal.aborted) {
        screen.update({ notice: `Tunnel to ${machine.key}/${project.key} closed.` })
      }
    } catch (error: unknown) {
      if (active && !controller.signal.aborted) {
        updateTunnelState(key, 'failed')
        screen.update({ diagnostic: safeError(error) })
      }
    } finally {
      tunnelControllers.delete(key)
      if (active) clearTunnelState(key)
    }
  }

  async function startFleetProject(
    machine: MachineInventory,
    project: MachineProjectInventory,
  ): Promise<void> {
    if (machine.key === 'local' || actionRunning) return
    let started = false
    actionRunning = true
    screen.update({ busy: `Checking ${machine.key}/${project.key}`, diagnostic: undefined })
    try {
      const latest = await inspectFleet()
      const remote = latest.machines.find((entry) => entry.key === machine.key)
      const remoteProject = remote?.projects.find((entry) => entry.key === project.key)
      if (!remote || remote.connection !== 'online') throw new Error('The selected Machine is no longer online.')
      if (!remote.capabilities.lifecycle) throw new Error('The selected Machine does not support remote lifecycle actions.')
      if (!remoteProject?.available) throw new Error('The selected remote AliceProject is no longer available.')
      if (remoteProject.runtime.class !== 'absent') throw new Error('The selected remote AliceProject is not stopped.')
      const registry = await loadMachines()
      const registered = registry.machines.find((entry) => entry.key === machine.key)
      if (!registered) throw new Error(`Machine "${machine.key}" is no longer registered.`)
      screen.update({ busy: `Starting ${machine.key}/${project.key}` })
      await startRemoteProject(registered, project.key)
      started = true
      screen.update({ notice: `Started ${machine.displayName} / ${project.displayName}.` })
    } catch (error: unknown) {
      screen.update({ diagnostic: safeError(error) })
    } finally {
      actionRunning = false
      screen.update({ busy: undefined })
    }
    if (started) await refreshFleet({ quiet: true })
  }

  function updateTunnelState(
    key: string,
    value: 'connecting' | 'connected' | 'failed',
  ): void {
    const current = screen.snapshot.fleet
    if (!current) return
    screen.update({
      fleet: {
        ...current,
        tunnels: { ...current.tunnels, [key]: value },
      },
    })
  }

  function clearTunnelState(key: string): void {
    const current = screen.snapshot.fleet
    if (!current) return
    const tunnels = { ...current.tunnels }
    delete tunnels[key]
    screen.update({ fleet: { ...current, tunnels } })
  }

  async function requestAction(action: SupervisorAction): Promise<void> {
    if (configRecovery && action !== 'update' && action !== 'apply-update') {
      screen.update({ notice: configRecoveryBlockedNotice() })
      return
    }
    if (
      (action === 'start' || action === 'start-open')
      && context?.appDir === null
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
    if (configRecovery && action !== 'update' && action !== 'apply-update') {
      screen.update({ notice: configRecoveryBlockedNotice() })
      return
    }
    actionRunning = true
    let actionFailure: string | undefined
    const homeRoot = context?.home
    const actionLabel = actionName(action)
    screen.update({
      busy: actionLabel,
      notice: undefined,
      diagnostic: undefined,
      ...(action === 'apply-update' ? { confirmation: undefined } : {}),
    })
    try {
      if (action === 'update') {
        const update = await services.checkUpdate()
        screen.update({
          update,
          notice: formatUpdateNotice(update),
          confirmation: update.status === 'available' ? 'update' : undefined,
        })
      } else if (action === 'apply-update') {
        const update = screen.snapshot.update
        if (update?.status !== 'available') {
          throw new Error('No verified OpenAlice update is ready to install. Press u to check again.')
        }
        await services.applyUpdate(update)
        screen.update({
          update,
          notice: formatUpdateInstalledNotice(update),
        })
      } else if (!context || homeRoot === undefined) {
        throw new Error(configRecoveryBlockedNotice())
      } else if (action === 'start' || action === 'start-open') {
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
    if (configRecovery || !context) {
      screen.update({ notice: configRecoveryBlockedNotice() })
      return
    }
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
    if (configRecovery || !context) {
      screen.update({ notice: configRecoveryBlockedNotice() })
      return
    }
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
      const nextContext = await configureProject(context, {
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
    if (configRecovery || !context) {
      screen.update({ notice: configRecoveryBlockedNotice() })
      return
    }
    const sourceContext = context
    if (
      sourcePromptActive
      || settingsActive
      || projectsActive
      || actionRunning
    ) return
    const source = sourceContext.provenance.appDir.source
    if (source === 'environment' || source === 'cli-flag') {
      screen.update({
        notice: `Source is locked by ${sourceContext.provenance.appDir.detail}; change that override and reopen the Supervisor.`,
      })
      return
    }

    sourcePromptActive = true
    let saving = false
    const input = new (class extends piTui.Input {
      detail = reason
        ? `Start needs an OpenAlice source checkout. ${reason}`
        : 'Choose the OpenAlice source checkout for this AliceProject.'

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
          'Enter  Save for this AliceProject and start',
          'Esc    Cancel',
        ]
      }
    })()
    input.setValue(sourceContext.appDir ?? process.cwd())
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
          const nextContext = await configureProject(sourceContext, { appDir })
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
    if (configRecovery || !context) {
      screen.update({ notice: configRecoveryBlockedNotice() })
      return
    }
    let settingsContext = context
    if (
      settingsActive
      || sourcePromptActive
      || projectsActive
      || actionRunning
    ) return
    actionRunning = true
    screen.update({
      busy: 'Loading AliceProject settings',
      notice: undefined,
      diagnostic: undefined,
    })
    let storedProject: AliceProjectLaunchConfig
    let storedMachine: LaunchConfigValues
    try {
      ;[storedProject, storedMachine] = await Promise.all([
        loadProjectConfig(settingsContext),
        loadMachineConfig(settingsContext),
      ])
    } catch (error: unknown) {
      screen.update({
        diagnostic: `Could not load AliceProject settings: ${safeError(error)}`,
      })
      return
    } finally {
      actionRunning = false
      if (active) screen.update({ busy: undefined })
    }
    if (!active) return

    settingsActive = true
    let saving = false
    let scope: typeof PROJECT_SCOPE | typeof MACHINE_SCOPE = PROJECT_SCOPE
    let message = 'Changes apply to this AliceProject. Environment and command-line overrides remain locked.'
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
      const stored = scope === PROJECT_SCOPE ? storedProject : storedMachine
      const editingMachine = scope === MACHINE_SCOPE
      const runtimeStopped = screen.snapshot.runtime?.class === 'absent'
      const homeLocked = editingMachine
        ? undefined
        : settingOverrideLock(settingsContext.provenance.home)
      const portLocked = editingMachine
        ? undefined
        : settingOverrideLock(settingsContext.provenance.port)
      const updatesLocked = editingMachine
        ? undefined
        : settingOverrideLock(settingsContext.provenance.updateChecks)
      const homeAffectsRunning = !editingMachine
        || machineDefaultAffectsCurrent('home', settingsContext)
      const portAffectsRunning = !editingMachine
        || machineDefaultAffectsCurrent('port', settingsContext)
      const homeEditable = !homeLocked
        && (runtimeStopped || !homeAffectsRunning)
      const portEditable = !portLocked
        && (runtimeStopped || !portAffectsRunning)
      const layerDescription = editingMachine
        ? 'Default for AliceProjects that do not set their own value.'
        : `Overrides machine defaults for AliceProject "${settingsContext.aliceProject.displayName}".`
      const homeItem: SettingItem = {
        id: 'home',
        label: 'Data home',
        currentValue: homeLocked
          ? `${settingsContext.home} · locked`
          : editingMachine
            ? machineHomeSettingValue(stored.home)
            : inheritedSettingValue(stored.home, settingsContext.home),
        description: homeLocked
          ?? (
            homeEditable
              ? (
                  editingMachine
                    ? 'Default complete home for the implicit AliceProject. Blank uses ~/.openalice.'
                    : settingsContext.project === 'default'
                    ? 'Where this AliceProject keeps settings, credentials, workspaces, and runtime state. Blank uses the inherited location.'
                    : 'Where this named AliceProject keeps its separate settings, credentials, workspaces, and runtime state.'
                )
              : 'Stop OpenAlice before changing the complete home used by this running AliceProject.'
          ),
      }
      if (homeEditable) {
        homeItem.submenu = (_currentValue, done) => inputSubmenu(
          editingMachine ? 'Set machine-default complete home' : 'Set AliceProject complete home',
          stored.home ?? '',
          (value) => (
            !editingMachine && settingsContext.project !== 'default' && value === ''
              ? 'Named AliceProjects require an explicit complete home.'
              : undefined
          ),
          done,
          editingMachine || settingsContext.project === 'default'
            ? 'Leave blank to inherit from the next lower-priority layer.'
            : 'Named AliceProjects require a separate complete home.',
        )
      }
      const portItem: SettingItem = {
        id: 'port',
        label: 'Browser port',
        currentValue: portLocked
          ? `${settingsContext.port} · locked`
          : editingMachine
            ? machinePortSettingValue(stored.port)
            : portSettingValue(stored.port, settingsContext),
        description: portLocked
          ?? (
            portEditable
              ? `${layerDescription} Blank chooses an available port automatically.`
              : 'Stop OpenAlice before changing the browser port used by this running AliceProject.'
          ),
      }
      if (portEditable) {
        portItem.submenu = (_currentValue, done) => inputSubmenu(
          editingMachine ? 'Set machine-default browser port' : 'Set AliceProject browser port',
          stored.port?.toString() ?? '',
          validatePortSetting,
          done,
        )
      }
      const updateItem: SettingItem = {
        id: 'updateChecks',
        label: 'Update checks',
        currentValue: updatesLocked
          ? `${settingsContext.updateChecks ? ENABLED_SETTING : DISABLED_SETTING} · locked`
          : editingMachine
            ? machineBooleanSettingValue(stored.updateChecks)
            : booleanSettingValue(stored.updateChecks),
        description: updatesLocked
          ?? `${layerDescription} This AliceProject currently resolves to ${settingsContext.updateChecks ? 'enabled' : 'disabled'}.`,
      }
      if (!updatesLocked) {
        updateItem.values = [
          INHERIT_SETTING,
          ENABLED_SETTING,
          DISABLED_SETTING,
        ]
      }
      const runtimeItem: SettingItem = settingsContext.runtimeProvider.kind === 'bundle'
        ? {
            id: 'source',
            label: 'Installed Runtime',
            currentValue: `OpenAlice ${screen.snapshot.version} · ${settingsContext.runtimeProvider.contentIdentity ?? 'verified'}`,
            description: `Managed by the installer at ${settingsContext.appDir ?? 'an unavailable path'}. No source checkout is needed.`,
          }
        : {
            id: 'source',
            label: 'Source checkout',
            currentValue: settingsContext.appDir ?? 'current directory discovery',
            description: 'Advanced development provider. Use m for managed source or c to choose a checkout.',
          }
      items.splice(0, items.length,
        {
          id: 'scope',
          label: 'Editing',
          currentValue: scope,
          values: [PROJECT_SCOPE, MACHINE_SCOPE],
          description: editingMachine
            ? 'Machine defaults are inherited by AliceProjects without their own value.'
            : 'AliceProject values override machine defaults. Environment and command-line values remain higher priority.',
        },
        homeItem,
        portItem,
        updateItem,
        runtimeItem,
        {
          id: 'config',
          label: 'Advanced config',
          currentValue: join(settingsContext.supervisorRoot, 'config.json'),
          description: 'Read-only location for machine defaults and named AliceProject settings.',
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
        scope = newValue === MACHINE_SCOPE ? MACHINE_SCOPE : PROJECT_SCOPE
        syncItems()
        updateDisplayedValues()
        setMessage(
          scope === MACHINE_SCOPE
            ? 'Editing machine defaults. AliceProject, environment, and command-line layers remain above them.'
            : `Editing AliceProject "${settingsContext.aliceProject.displayName}". Environment and command-line layers remain above it.`,
        )
        return
      }
      const field = settingField(id)
      if (!field) return
      const editingMachine = scope === MACHINE_SCOPE
      const lock = editingMachine
        ? undefined
        : settingOverrideLock(settingsContext.provenance[field])
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
          || machineDefaultAffectsCurrent(field, settingsContext)
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
      const layerLabel = editingMachine ? 'machine default' : `AliceProject "${settingsContext.aliceProject.displayName}"`
      setMessage(`Saving ${settingLabel(field)} for ${layerLabel}…`)
      try {
        settingsContext = editingMachine
          ? await configureMachine(settingsContext, patch)
          : await configureProject(settingsContext, patch)
        context = settingsContext
        services = createServices(dependencies, settingsContext)
        ;[storedProject, storedMachine] = await Promise.all([
          loadProjectConfig(settingsContext),
          loadMachineConfig(settingsContext),
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
          `OpenAlice setup · ${settingsContext.aliceProject.displayName}`,
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

  async function openProjects(): Promise<void> {
    if (configRecovery || !context) {
      screen.update({ notice: configRecoveryBlockedNotice() })
      return
    }
    let projectContext = context
    if (
      projectsActive
      || sourcePromptActive
      || settingsActive
      || actionRunning
    ) return
    actionRunning = true
    screen.update({
      busy: 'Loading AliceProjects',
      notice: undefined,
      diagnostic: undefined,
    })
    let registry: SupervisorAliceProjectRegistry
    try {
      registry = await loadProjectRegistry(projectContext)
    } catch (error: unknown) {
      screen.update({
        diagnostic: `Could not load AliceProjects: ${safeError(error)}`,
      })
      return
    } finally {
      actionRunning = false
      if (active) screen.update({ busy: undefined })
    }
    if (!active) return

    projectsActive = true
    let changing = false
    let message = 'Selecting an AliceProject also makes it the next bare-start default. Copy AI credentials with openalice project copy-ai-creds.'
    const lock = instanceSelectionOverrideLock(projectContext)
    if (lock) message = lock
    const createValue = '__create_alice_project__'
    const visibleInstances = registry.projects.some(
      (entry) => entry.key === projectContext.project,
    )
      ? registry.projects
      : [
          ...registry.projects,
          {
            id: projectContext.aliceProject.id,
            key: projectContext.project,
            name: projectContext.project,
            displayName: projectContext.aliceProject.displayName,
            home: projectContext.home,
            port: projectContext.port,
            portAutomatic: projectContext.provenance.port.source === 'default',
            isDefault: false,
          },
        ]
    const items: SelectItem[] = visibleInstances.map((entry) => ({
      value: entry.key,
      label: [
        entry.displayName,
        entry.key === projectContext.project ? 'current' : undefined,
        entry.isDefault ? 'default' : undefined,
      ].filter(Boolean).join(' · '),
      description: `${entry.home} · Web ${entry.portAutomatic ? `auto from ${entry.port}` : entry.port}`,
    }))
    if (!lock) {
      items.push({
        value: createValue,
        label: '+ Create AliceProject…',
        description: 'Register a separate complete home and select it.',
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
      (item) => item.value === projectContext.project,
    )
    list.setSelectedIndex(Math.max(0, selectedIndex))
    let component: Component = list

    const setMessage = (next: string) => {
      message = next
      ui.requestRender()
    }
    const close = (notice = 'AliceProject selection closed.') => {
      if (!projectsActive) return
      projectsActive = false
      closeProjects = null
      overlay.hide()
      ui.setShowHardwareCursor(false)
      screen.update({ notice })
    }
    const showList = () => {
      ui.setShowHardwareCursor(false)
      component = list
      setMessage(lock ?? 'Selecting an AliceProject also makes it the next bare-start default. Copy AI credentials with openalice project copy-ai-creds.')
    }
    const activateContext = async (
      operation: () => Promise<ResolvedLaunchContext>,
      notice: (next: ResolvedLaunchContext) => string,
    ) => {
      if (changing) return
      changing = true
      actionRunning = true
      setMessage('Switching AliceProject…')
      try {
        const next = await operation()
        projectContext = next
        context = projectContext
        services = createServices(dependencies, projectContext)
        screen.update({
          context,
          runtime: null,
          diagnostic: undefined,
        })
        close(notice(next))
      } catch (error: unknown) {
        setMessage(`Could not switch AliceProject: ${safeError(error)}`)
      } finally {
        actionRunning = false
        changing = false
        await refreshRuntime()
      }
    }
    const showCreateHomeInput = (name: string) => {
      const defaultHome = registry.projects.find(
        (entry) => entry.key === 'default',
      )?.home ?? projectContext.home
      const suggestedHome = join(
        dirname(defaultHome),
        `.openalice-${name}`,
      )
      const input = new (class extends piTui.Input {
        detail = 'Use a separate complete home. An empty directory is prepared when registered.'

        setDetail(next: string): void {
          this.detail = next
          this.invalidate()
          ui.requestRender()
        }

        override render(width: number): string[] {
          return [
            `Create AliceProject · ${name}`,
            '',
            'Complete home',
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
          input.setDetail('Enter a complete home for this AliceProject.')
          return
        }
        void activateContext(
          () => createProject(projectContext, name, home),
          (next) => `Created and selected AliceProject ${next.aliceProject.displayName}.`,
        )
      }
      component = input
      setMessage('The new AliceProject owns only its registry entry; existing data is never copied or deleted.')
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
            'Create AliceProject',
            '',
            'AliceProject key',
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
        const validation = validateSupervisorAliceProjectKey(name)
        if (validation) {
          input.setDetail(validation)
          return
        }
        if (registry.projects.some((entry) => entry.key === name)) {
          input.setDetail(`AliceProject "${name}" is already registered.`)
          return
        }
        input.focused = false
        showCreateHomeInput(name)
      }
      component = input
      setMessage('Create a named AliceProject without leaving the Supervisor.')
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
        item.value === projectContext.project
        && item.value === registry.defaultProject
      ) {
        close(`AliceProject ${projectContext.aliceProject.displayName} is already selected.`)
        return
      }
      void activateContext(
        () => selectProject(projectContext, item.value),
        (next) => `Selected AliceProject ${next.aliceProject.displayName}; future bare starts use it.`,
      )
    }

    const panel = new (class implements Component {
      render(width: number): string[] {
        return [
          'OpenAlice AliceProjects',
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
    closeProjects = () => close()
    overlay.focus()
  }

  async function openTransferWizard(source: MachineProjectInventory): Promise<void> {
    if (transferActive || sourcePromptActive || settingsActive || projectsActive || actionRunning) return
    const fleetState = screen.snapshot.fleet
    if (!fleetState) return
    actionRunning = true
    screen.update({ busy: 'Checking transfer source', notice: undefined, diagnostic: undefined })
    try {
      const sourceRuntime = await inspectTransferSource(source.home)
      if (sourceRuntime.class !== 'absent') {
        screen.update({ notice: `Stop local AliceProject ${source.key} before transfer. No source process was changed.` })
        return
      }
    } catch (error: unknown) {
      screen.update({ diagnostic: `Could not inspect transfer source: ${safeError(error)}` })
      return
    } finally {
      actionRunning = false
      screen.update({ busy: undefined })
    }

    const state = createSupervisorTransferWizard(source, fleetState.machines)
    if (state.destinations.length === 0) {
      screen.update({ notice: 'No online compatible SSH Machine can receive an AliceProject.' })
      return
    }
    transferActive = true
    let component: Component
    let message = 'Choose the SSH Machine that will own the new AliceProject.'
    let transferController: AbortController | null = null
    const theme: SelectListTheme = {
      selectedPrefix: (text) => text,
      selectedText: (text) => text,
      description: (text) => text,
      scrollInfo: (text) => text,
      noMatch: (text) => text,
    }
    const setMessage = (next: string) => { message = next; ui.requestRender() }
    const close = (notice = 'Transfer cancelled. Nothing changed.') => {
      if (!transferActive) return
      transferController?.abort()
      transferActive = false
      closeTransfer = null
      overlay.hide()
      ui.setShowHardwareCursor(false)
      screen.update({ notice })
    }
    const showInput = (
      title: string,
      initial: string,
      detail: string,
      validate: (value: string) => string | undefined,
      submit: (value: string) => void,
      back: () => void,
    ) => {
      const input = new (class extends piTui.Input {
        detailText = detail
        override render(width: number): string[] {
          return [title, '', ...super.render(width), '', sanitize(this.detailText), '', 'Enter  Continue · Esc  Back']
        }
      })()
      input.setValue(initial)
      input.focused = true
      ui.setShowHardwareCursor(true)
      input.onEscape = () => { input.focused = false; ui.setShowHardwareCursor(false); back() }
      input.onSubmit = (value) => {
        const normalized = value.trim()
        const issue = validate(normalized)
        if (issue) { input.detailText = issue; input.invalidate(); ui.requestRender(); return }
        input.focused = false
        ui.setShowHardwareCursor(false)
        submit(normalized)
      }
      component = input
      ui.requestRender()
    }
    const showChoice = (
      title: string,
      items: SelectItem[],
      select: (value: string) => void,
      back: () => void,
    ) => {
      const list = new piTui.SelectList(items, Math.min(8, items.length), theme)
      list.onSelect = (item) => select(item.value)
      list.onCancel = back
      component = new (class implements Component {
        render(width: number): string[] { return [title, '', ...list.render(width)] }
        handleInput(data: string): void { list.handleInput(data) }
        invalidate(): void { list.invalidate() }
      })()
      ui.requestRender()
    }
    const showDestination = () => showChoice(
      `Transfer ${source.displayName} · destination Machine`,
      state.destinations.map((machine) => ({
        value: machine.key,
        label: machine.displayName,
        description: `${machine.sshTarget ?? machine.key} · ${machine.projects.length} AliceProject(s)`,
      })),
      (value) => {
        selectTransferDestination(state, value)
        state.phase = 'project-key'
        showProjectKey()
      },
      () => close(),
    )
    const showProjectKey = () => showInput(
      'Destination AliceProject key', state.projectKey,
      'A new registry key; existing remote AliceProjects are never replaced.',
      (value) => validateSupervisorAliceProjectKey(value),
      (value) => { state.projectKey = value; state.phase = 'home'; showHome() },
      showDestination,
    )
    const showHome = () => showInput(
      'Destination complete Home', state.destinationHome,
      'Must be a new absolute POSIX path on the SSH Machine.',
      (value) => posix.isAbsolute(value) ? undefined : 'Enter an absolute remote path.',
      (value) => { state.destinationHome = value; state.phase = 'credentials'; showCredentials() },
      showProjectKey,
    )
    const showCredentials = () => showChoice(
      'Credentials', [
        { value: 'include', label: 'Transfer and re-seal', description: 'AI/provider values travel through SSH stdin; broker/Connector secrets get a new remote key.' },
        { value: 'omit', label: 'Leave credentials behind', description: 'Portable configuration remains; integrations require remote setup.' },
      ],
      (value) => { state.credentials = value === 'omit' ? 'omit' : 'include'; state.phase = 'issue-policy'; showIssuePolicy() },
      showHome,
    )
    const showIssuePolicy = () => showChoice(
      'Exact-Session scheduled Issue owners', [
        { value: 'keep-blocked', label: 'Keep blocked', description: 'Preserve exact old owners; they remain unavailable remotely.' },
        { value: 'new-then-resume', label: 'Create new Session on fire', description: 'Rewrite only affected scheduled Issues to @new-then-resume.' },
      ],
      (value) => { state.issuePolicy = value === 'new-then-resume' ? 'new-then-resume' : 'keep-blocked'; void buildReview() },
      showCredentials,
    )
    const buildReview = async () => {
      const destination = selectedTransferDestination(state)!
      state.phase = 'planning'
      setMessage('Building a checksum and exclusion plan…')
      component = { render: () => ['Planning transfer…'], invalidate: () => undefined }
      try {
        const latest = await inspectFleet()
        const remote = latest.machines.find((machine) => machine.key === destination.key)
        if (!remote || remote.connection !== 'online') throw new Error('Destination Machine is no longer online.')
        if (remote.projects.some((project) => project.key === state.projectKey || remoteHomesOverlap(project.home, state.destinationHome))) {
          throw new Error('Destination key or Home now conflicts with a registered remote AliceProject.')
        }
        state.plan = await planTransfer({
          source: { id: source.id, key: source.key, displayName: source.displayName, home: source.home, port: source.port, portAutomatic: source.portAutomatic, isDefault: source.isDefault },
          destinationMachineKey: destination.key,
          destinationProjectKey: state.projectKey,
          destinationDisplayName: source.displayName,
          destinationHome: state.destinationHome,
          credentials: state.credentials,
          scheduledIssues: state.issuePolicy,
          env: dependencies.env ?? process.env,
        })
        state.phase = 'review'
        component = reviewComponent()
        setMessage('Review every boundary before transfer. Default is No.')
      } catch (error: unknown) {
        state.phase = 'failed'; state.error = safeError(error)
        component = failureComponent()
        setMessage('Planning failed; neither Machine was changed.')
      }
    }
    const reviewComponent = (): Component => ({
      render: (width) => renderTransferPlanReview(state.plan!, width),
      handleInput: (data) => {
        if (piTui.matchesKey(data, 'escape') || piTui.matchesKey(data, 'n')) close()
        else if ((piTui.matchesKey(data, 'y') || piTui.matchesKey(data, 'enter')) && state.plan?.readyToApply) void applyTransfer()
      },
      invalidate: () => undefined,
    })
    const failureComponent = (): Component => ({
      render: (width) => [
        'Transfer failed',
        '',
        sanitize(state.error ?? 'Unknown error'),
        '',
        state.plan?.readyToApply
          ? 'r  Retry the same transaction · Enter / Esc  Close'
          : 'r  Rebuild the plan · Enter / Esc  Close',
      ].map((line) => truncate(line, width)),
      handleInput: (data) => {
        if (piTui.matchesKey(data, 'r')) {
          state.error = null
          if (state.plan?.readyToApply) void applyTransfer()
          else void buildReview()
        } else if (piTui.matchesKey(data, 'enter') || piTui.matchesKey(data, 'escape')) {
          close('Transfer closed. Source remains unchanged.')
        }
      },
      invalidate: () => undefined,
    })
    const applyTransfer = async () => {
      const destination = selectedTransferDestination(state)!
      const registry = await loadMachines()
      const machine = registry.machines.find((entry) => entry.key === destination.key)
      if (!machine) { state.error = 'Destination Machine is no longer registered.'; state.phase = 'failed'; component = failureComponent(); return }
      state.phase = 'transferring'
      transferController = new AbortController()
      let progress = { files: 0, bytes: 0, totalFiles: state.plan!.portable.files, totalBytes: state.plan!.portable.bytes }
      component = {
        render: () => [
          'Transferring…',
          '',
          `${progress.files}/${progress.totalFiles} files · ${formatTransferProgress(progress.bytes, progress.totalBytes)}`,
          'Checksums are verified before atomic publish.',
          'Esc / Ctrl+C  Cancel',
        ],
        handleInput: (data) => {
          if (piTui.matchesKey(data, 'escape')) {
            transferController?.abort()
            setMessage('Cancelling transfer; the remote receiver will retain only marked transaction staging.')
          }
        },
        invalidate: () => undefined,
      }
      setMessage('Streaming portable files and private credential frames over SSH…')
      try {
        const sourceRuntime = await inspectTransferSource(source.home)
        if (sourceRuntime.class !== 'absent') throw new Error('Source Runtime changed after planning; transfer was not started.')
        const latest = await inspectFleet()
        const remote = latest.machines.find((entry) => entry.key === destination.key)
        if (!remote || remote.connection !== 'online' || !remote.capabilities.transferReceive) {
          throw new Error('Destination Machine changed after planning; transfer was not started.')
        }
        if (remote.projects.some((project) => project.key === state.projectKey || remoteHomesOverlap(project.home, state.destinationHome))) {
          throw new Error('Destination key or Home changed after planning; transfer was not started.')
        }
        state.receipt = await sendTransfer({
          machine,
          plan: state.plan!,
          signal: transferController.signal,
          onProgress: (next) => { progress = next; ui.requestRender() },
        })
        state.phase = 'success'
        component = successComponent(machine)
        setMessage('Published and registered. Source and remote default remain unchanged.')
        await refreshFleet({ quiet: true })
      } catch (error: unknown) {
        state.phase = 'failed'; state.error = safeError(error); component = failureComponent()
        setMessage('Transfer did not complete. Retry uses only its marked transaction staging.')
      }
      ui.requestRender()
    }
    const successComponent = (machine: RegisteredMachine): Component => ({
      render: (width) => renderTransferResult(state.receipt!, machine.displayName, state.projectKey, width),
      handleInput: (data) => {
        if (piTui.matchesKey(data, 'enter') || piTui.matchesKey(data, 'escape')) { close(`Transferred ${machine.key}/${state.projectKey}.`) }
        else if (piTui.matchesKey(data, 's')) void (async () => {
          setMessage(`Starting ${machine.key}/${state.projectKey}…`)
          try { await startRemoteProject(machine, state.projectKey); await refreshFleet({ quiet: true }); setMessage('Remote Runtime started. Press o to connect/open.') }
          catch (error: unknown) { setMessage(`Could not start remote Runtime: ${safeError(error)}`) }
        })()
        else if (piTui.matchesKey(data, 'o')) void (async () => {
          await refreshFleet({ quiet: true })
          const remote = screen.snapshot.fleet?.machines.find((entry) => entry.key === machine.key)
          const project = remote?.projects.find((entry) => entry.key === state.projectKey)
          if (remote && project) { close(`Transferred ${machine.key}/${state.projectKey}.`); await activateFleetProject(remote, project) }
          else setMessage('Refresh did not find the transferred AliceProject yet.')
        })()
      },
      invalidate: () => undefined,
    })
    showDestination()
    const panel = new (class implements Component {
      render(width: number): string[] { return ['AliceProject Remote Transfer', '─'.repeat(Math.max(1, width)), '', ...component.render(width), '', sanitize(message)] }
      handleInput(data: string): void { component.handleInput?.(data) }
      invalidate(): void { component.invalidate() }
    })()
    const overlay = ui.showOverlay(panel, { width: '92%', maxHeight: '92%', anchor: 'center', margin: 1 })
    closeTransfer = () => close()
    overlay.focus()
  }

  async function discoverUpdateInBackground(): Promise<void> {
    if (context ? !context.updateChecks : launchFlags.updateChecks === false) {
      return
    }
    try {
      const update = await services.discoverUpdate()
      if (!update) return
      if (!active) return
      screen.update({
        update,
        ...(update.status === 'available'
          ? { notice: formatUpdateNotice(update, 'discover') }
          : {}),
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
      for (const controller of tunnelControllers.values()) controller.abort()
      tunnelControllers.clear()
      closeSourcePrompt?.()
      closeSettings?.()
      closeProjects?.()
      closeTransfer?.()
      removeInputListener()
      process.off('SIGTERM', onTerminate)
      process.off('SIGINT', onTerminate)
      ui.stop()
      resolve(code)
    }
    const onTerminate = () => finish()
    const removeInputListener = ui.addInputListener((data) => {
      if (sourcePromptActive || settingsActive || projectsActive || transferActive) {
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
        || piTui.matchesKey(data, 'ctrl+c')
      ) {
        finish()
        return { consume: true }
      }
      if (piTui.matchesKey(data, 'escape')) {
        if (!screen.handleEscape()) finish()
        return { consume: true }
      }
      return screen.handleKey(data, piTui.matchesKey)
        ? { consume: true }
        : undefined
    })

    process.once('SIGTERM', onTerminate)
    process.once('SIGINT', onTerminate)
    ui.start()
    void refreshFleet({ quiet: true })
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
  private readonly onProjects?: () => void
  private readonly onActivateFleet?: (
    machine: MachineInventory,
    project: MachineProjectInventory,
  ) => void
  private readonly onStartFleet?: (
    machine: MachineInventory,
    project: MachineProjectInventory,
  ) => void
  private readonly onRefreshFleet?: () => void
  private readonly onTransferFleet?: (source: MachineProjectInventory) => void
  private readonly onRequestManagedSource?: () => void
  private readonly onPrepareManagedSource?: () => void
  private readonly requestRender?: () => void

  constructor(
    snapshot: SupervisorSnapshot,
    callbacks: {
      onAction?: (action: SupervisorAction) => void
      onConfigureSource?: () => void
      onSettings?: () => void
      onProjects?: () => void
      onActivateFleet?: (
        machine: MachineInventory,
        project: MachineProjectInventory,
      ) => void
      onStartFleet?: (
        machine: MachineInventory,
        project: MachineProjectInventory,
      ) => void
      onRefreshFleet?: () => void
      onTransferFleet?: (source: MachineProjectInventory) => void
      onRequestManagedSource?: () => void
      onPrepareManagedSource?: () => void
      requestRender?: () => void
    } = {},
  ) {
    this.snapshot = {
      panel: snapshot.fleet ? 'fleet' : 'overview',
      ...snapshot,
    }
    this.onAction = callbacks.onAction
    this.onConfigureSource = callbacks.onConfigureSource
    this.onSettings = callbacks.onSettings
    this.onProjects = callbacks.onProjects
    this.onActivateFleet = callbacks.onActivateFleet
    this.onStartFleet = callbacks.onStartFleet
    this.onRefreshFleet = callbacks.onRefreshFleet
    this.onTransferFleet = callbacks.onTransferFleet
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

  handleEscape(): boolean {
    if (
      this.snapshot.panel === 'fleet'
      && this.snapshot.fleet?.focus === 'projects'
    ) {
      this.update({ fleet: setFleetFocus(this.snapshot.fleet, 'machines') })
      return true
    }
    return false
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
        } else if (this.snapshot.confirmation === 'update') {
          this.onAction?.('apply-update')
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
    if (matchesKey(data, ']') || matchesKey(data, '[')) {
      this.selectAdjacentPanel(matchesKey(data, ']') ? 1 : -1)
      return true
    }
    const fleet = this.snapshot.panel === 'fleet' ? this.snapshot.fleet : null
    if (fleet) {
      if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
        this.update({
          fleet: moveFleetSelection(fleet, matchesKey(data, 'down') ? 1 : -1),
        })
        return true
      }
      if (matchesKey(data, 'tab') || matchesKey(data, 'right')) {
        this.update({ fleet: setFleetFocus(fleet, 'projects') })
        return true
      }
      if (matchesKey(data, 'shift+tab') || matchesKey(data, 'left')) {
        this.update({ fleet: setFleetFocus(fleet, 'machines') })
        return true
      }
      if (matchesKey(data, 'enter')) {
        if (fleet.focus === 'machines') {
          this.update({ fleet: setFleetFocus(fleet, 'projects') })
        } else {
          const machine = selectedFleetMachine(fleet)
          const project = selectedFleetProject(fleet)
          if (machine && project) this.onActivateFleet?.(machine, project)
          else this.update({ notice: 'No AliceProject is available on the selected Machine.' })
        }
        return true
      }
      const machine = selectedFleetMachine(fleet)
      const project = selectedFleetProject(fleet)
      const remote = machine?.key !== 'local'
      if (matchesKey(data, 'r') && remote) {
        this.onRefreshFleet?.()
        return true
      }
      if (matchesKey(data, 'o') && remote) {
        if (machine && project) this.onActivateFleet?.(machine, project)
        else this.update({ notice: 'No remote AliceProject is available to connect.' })
        return true
      }
      if (matchesKey(data, 's') && remote) {
        if (!machine || !project) this.update({ notice: 'No remote AliceProject is available to start.' })
        else if (machine.connection !== 'online') this.update({ notice: 'The selected Machine is not online.' })
        else if (!machine.capabilities.lifecycle) this.update({ notice: 'This Machine does not support remote lifecycle actions.' })
        else if (!project.available || project.runtime.class !== 'absent') this.update({ notice: 'Start is available only for a stopped remote AliceProject.' })
        else this.onStartFleet?.(machine, project)
        return true
      }
      if (matchesKey(data, 'm') && !remote) {
        if (project) this.onTransferFleet?.(project)
        else this.update({ notice: 'Select a local AliceProject to transfer.' })
        return true
      }
      const remoteMutationKeys: KeyId[] = ['x', 'd', 'l', 'p', 'c', 'm']
      if (remote && remoteMutationKeys.some((key) => matchesKey(data, key))) {
        this.update({
          notice: 'That mutation is not available for a remote selection. Use r to refresh or Enter/o to connect a running AliceProject.',
        })
        return true
      }
    }
    if (matchesKey(data, 'enter')) {
      if (isConfigRecovery(this.snapshot)) {
        this.update({ notice: configRecoveryBlockedNotice() })
        return true
      }
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
      if (isConfigRecovery(this.snapshot)) {
        this.update({ notice: configRecoveryBlockedNotice() })
      } else if (this.snapshot.runtime?.class === 'absent') {
        this.onConfigureSource?.()
      } else {
        this.update({
          notice: 'Stop the selected Runtime before changing its source checkout.',
        })
      }
      return true
    }
    if (matchesKey(data, 'p')) {
      if (isConfigRecovery(this.snapshot)) {
        this.update({ notice: configRecoveryBlockedNotice() })
      } else {
        this.onSettings?.()
      }
      return true
    }
    if (matchesKey(data, 'i')) {
      if (isConfigRecovery(this.snapshot)) {
        this.update({ notice: configRecoveryBlockedNotice() })
      } else {
        this.onProjects?.()
      }
      return true
    }
    if (matchesKey(data, 'm')) {
      if (isConfigRecovery(this.snapshot)) {
        this.update({ notice: configRecoveryBlockedNotice() })
      } else if (this.snapshot.runtime?.class === 'absent') {
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
        else {
          this.update({
            notice: unavailableActionMessage(
              action,
              this.snapshot.runtime,
              isConfigRecovery(this.snapshot),
            ),
          })
        }
        return true
      }
    }
    if (matchesKey(data, 'x') || matchesKey(data, 'r')) {
      const action = matchesKey(data, 'x') ? 'stop' : 'restart'
      if (!this.actionAvailable(action)) {
        this.update({
          notice: unavailableActionMessage(
            action,
            this.snapshot.runtime,
            isConfigRecovery(this.snapshot),
          ),
        })
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
      renderTabs(this.snapshot.panel ?? 'overview', narrow, isConfigRecovery(this.snapshot)),
      '',
    ]

    if (this.snapshot.panel === 'fleet' && this.snapshot.fleet) {
      lines.push(...renderSupervisorFleet(this.snapshot.fleet, width))
      const fleetMachine = selectedFleetMachine(this.snapshot.fleet)
      const fleetProject = selectedFleetProject(this.snapshot.fleet)
      if (fleetMachine?.key === 'local' && fleetProject) {
        lines.push(
          '',
          narrow ? `Runtime: ${state}` : `Runtime state: ${state}`,
          `AliceProject: ${fleetProject.displayName}`,
          `Home: ${fleetProject.home}`,
        )
        if (!narrow && this.snapshot.context) {
          lines.push(`Resolved: home ${formatProvenance(this.snapshot.context.provenance.home)} · port ${formatPortResolution(this.snapshot.context)}`)
        }
        lines.push('', ...renderGuidance(runtime, this.snapshot.context))
      }
    } else if (this.snapshot.panel === 'logs') {
      lines.push(...renderLogs(this.snapshot.logs))
    } else if (this.snapshot.panel === 'doctor') {
      lines.push(...renderDoctor(this.snapshot.doctor))
    } else if (this.snapshot.panel === 'help') {
      lines.push(...renderHelp(isConfigRecovery(this.snapshot)))
    } else if (isConfigRecovery(this.snapshot)) {
      lines.push(...renderConfigRecovery(this.snapshot))
    } else {
      lines.push(
        narrow ? `Runtime: ${state}` : `Runtime state: ${state}`,
        `AliceProject: ${this.snapshot.context?.aliceProject.displayName ?? 'Default AliceProject'}`,
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
        this.snapshot.update,
      ))
    }
    if (this.snapshot.busy) lines.push('', `Working: ${this.snapshot.busy}…`)
    if (this.snapshot.notice) lines.push('', `Notice: ${sanitize(this.snapshot.notice)}`)
    if (this.snapshot.diagnostic) {
      lines.push('', `Diagnostic: ${sanitize(this.snapshot.diagnostic)}`)
    }
    lines.push(
      '',
      ...(this.snapshot.panel === 'fleet' && this.snapshot.fleet
        ? fleetActionBar(
            this.snapshot.fleet,
            runtime,
            this.snapshot.context,
            width,
          )
        : actionBar(runtime, this.snapshot.context, width, isConfigRecovery(this.snapshot))),
      'q / Esc / Ctrl+C  Detach without stopping',
    )
    return lines.map((line) => truncate(line, width))
  }

  invalidate(): void {}

  private actionAvailable(action: SupervisorAction): boolean {
    if (isConfigRecovery(this.snapshot)) {
      return action === 'update' || action === 'apply-update'
    }
    const runtime = this.snapshot.runtime
    if (action === 'logs' || action === 'doctor' || action === 'update') return true
    if (action === 'start' || action === 'start-open') {
      return runtime?.class === 'absent'
    }
    if (action === 'open') return Boolean(runtime?.endpoints?.web)
    if (action === 'apply-update') {
      return this.snapshot.update?.status === 'available'
    }
    return runtime?.owner?.surface === 'cli-server'
      && runtime.class !== 'absent'
      && runtime.class !== 'incompatible'
  }

  private selectAdjacentPanel(direction: 1 | -1): void {
    const panels: SupervisorPanel[] = isConfigRecovery(this.snapshot)
      ? ['overview', 'help']
      : ['fleet', 'overview', 'logs', 'doctor', 'help']
    const current = panels.indexOf(this.snapshot.panel ?? 'overview')
    const panel = panels[(current + direction + panels.length) % panels.length]
      ?? 'overview'
    this.update({ panel })
    if (panel === 'logs') this.onAction?.('logs')
    if (panel === 'doctor') this.onAction?.('doctor')
  }
}

function createServices(
  dependencies: SupervisorTuiDependencies,
  context: ResolvedLaunchContext | undefined,
  options: { configRecovery?: boolean } = {},
): SupervisorServices {
  const env = dependencies.env ?? process.env
  const shared = context && !options.configRecovery
    ? {
        env: buildAliceProjectEnv(
          context,
          buildManagedPiEnv(context, env),
        ),
      }
    : { env }
  const refuseProjectAction = async () => {
    throw new Error(configRecoveryBlockedNotice())
  }
  return {
    inspect: options.configRecovery
      ? refuseProjectAction
      : dependencies.inspect ?? ((inspectOptions) => inspectRuntime(inspectOptions, shared)),
    start: options.configRecovery
      ? refuseProjectAction
      : dependencies.start ?? ((startOptions) => startRuntime(startOptions, {
          ...shared,
          detached: true,
        })),
    stop: options.configRecovery
      ? refuseProjectAction
      : dependencies.stop ?? ((stopOptions) => stopRuntime(stopOptions, shared)),
    open: options.configRecovery
      ? refuseProjectAction
      : dependencies.open ?? ((openOptions) => openRuntime(openOptions, shared)),
    readLogs: options.configRecovery
      ? refuseProjectAction
      : dependencies.readLogs ?? ((logOptions) => readRuntimeLogs(logOptions, shared)),
    diagnose: options.configRecovery
      ? refuseProjectAction
      : dependencies.diagnose ?? ((doctorOptions) => diagnoseRuntime(doctorOptions, shared)),
    checkUpdate: dependencies.checkUpdate ?? (() => checkForUpdate({}, shared)),
    discoverUpdate: dependencies.discoverUpdate ?? (() => maybeNotifyUpdate(
      { enabled: true },
      { ...shared, interactive: true, stderr: SILENT_OUTPUT },
    )),
    applyUpdate: dependencies.applyUpdate
      ?? ((result) => applyVerifiedSupervisorUpdate(result, { env })),
  }
}

function renderTabs(
  selected: SupervisorPanel,
  narrow: boolean,
  recovery = false,
): string {
  const labels: Array<[SupervisorPanel, string]> = recovery
    ? [
        ['overview', narrow ? 'Home' : 'Overview'],
        ['help', 'Help'],
      ]
    : [
        ['fleet', narrow ? 'Fleet' : 'Machines'],
        ['overview', narrow ? 'Home' : 'Overview'],
        ['logs', 'Logs'],
        ['doctor', 'Doctor'],
        ['help', 'Help'],
      ]
  return labels
    .map(([panel, label]) => panel === selected ? `[${label}]` : label)
    .join('  ')
}

function fleetActionBar(
  fleet: SupervisorFleetState,
  runtime: RuntimeSummary | null,
  context: ResolvedLaunchContext | undefined,
  width: number,
): string[] {
  const machine = selectedFleetMachine(fleet)
  const project = selectedFleetProject(fleet)
  if (machine?.key === 'local') {
    return [
      ...actionBar(runtime, context, width, false)
        .map((line) => line
          .replace(' · m Managed', '')
          .replace('m Managed · ', '')
          .replace('  m Managed', '')),
      width < 72
        ? 'm Transfer · ↑/↓ Select · ←/→ Pane'
        : 'm Transfer · ↑/↓ Select · Tab/←/→ Pane · [ / ] Pages',
    ]
  }
  if (width < 72) {
    if (fleet.focus === 'machines') {
      return ['↑/↓ Select · Enter/→ Projects · ] Pages · ? Help']
    }
    return [
      machine?.key === 'local'
        ? '↑/↓ Select · Enter Activate · ← Machines · ] Pages'
        : project?.runtime.class === 'absent'
          ? '↑/↓ Select · s Start · r Refresh · ← Machines'
          : '↑/↓ Select · Enter/o Connect · r Refresh · ← Machines',
    ]
  }
  const primary = project?.runtime.class === 'absent'
    ? 's Start stopped AliceProject'
    : project
      ? 'Enter/o Connect running AliceProject'
      : 'Enter AliceProjects'
  return [
    `${primary} · ↑/↓ Select · Tab/←/→ Pane · r Refresh`,
    '[ / ] Pages · i AliceProjects · p Setup · ? Help',
  ]
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

function renderHelp(recovery = false): string[] {
  if (recovery) {
    return [
      'Supervisor recovery controls',
      '',
      'AliceProject configuration cannot be read by this OpenAlice.',
      'This shell will not inspect, start, stop, open, or configure a project.',
      '',
      'u  Check for and install a product update',
      '?  Toggle this help',
      'q / Esc  Detach only',
      '',
      'After a successful update, exit and run openalice again. This process does not reload.',
    ]
  }
  return [
    'Supervisor controls',
    '',
    'Enter  Start and open / open Web UI',
    's  Start in background            o  Open verified Web UI',
    'x  Stop (confirmation required)   r  Restart (confirmation required)',
    'l  Bounded redacted logs          d  Read-only Doctor',
    'u  Check for and install a product update',
    '?  Toggle this help',
    'i  Select or create an AliceProject',
    'p  Review setup for this AliceProject',
    'm  Fleet: transfer local project · Overview: prepare managed source',
    'c  Advanced: choose and remember a source checkout',
    'Tab / arrows  Change panel        q / Esc  Detach only',
    '',
    'The Supervisor manages Runtime state. Workspaces, trading, and chat stay in the Web UI.',
  ]
}

function renderConfigRecovery(snapshot: SupervisorSnapshot): string[] {
  return [
    'AliceProject configuration cannot be read.',
    snapshot.recoveryReason === 'newer-schema'
      ? 'This file requires a newer OpenAlice than the running CLI.'
      : 'It may be corrupt, or it may require a newer OpenAlice.',
    'This Supervisor will not inspect, start, open, stop, restart, or configure a project.',
    'Press u to check for and install an OpenAlice update, or ? for help.',
  ]
}

function renderConfirmation(
  action: SupervisorConfirmation,
  runtime: RuntimeSummary | null,
  managedSource?: ManagedSourcePlan | null,
  update?: UpdateResult | null,
): string[] {
  if (action === 'update') {
    return [
      `Install OpenAlice ${update?.latestVersion ?? 'the available update'} now?`,
      `Current CLI: ${update?.currentVersion ?? 'this running process'}.`,
      'This downloads the release installer, verifies its SHA-256, and atomically replaces the installed command.',
      'This running Supervisor will not reload. After success, exit and run openalice again.',
      'Press y / Enter to install, n / Esc to cancel.',
    ]
  }
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
  recovery = false,
): string[] {
  if (recovery) {
    const actions = 'u Update · ? Help'
    return actions.length <= width ? [actions] : ['u Update', '? Help']
  }
  const primary = runtime?.class === 'absent'
    ? context?.runtimeProvider.kind === 'bundle'
      ? 'Enter Start & open · s Background · p Setup · i AliceProjects'
      : 'Enter Start & open · s Background · p Setup · i AliceProjects · m Managed · c Source'
    : 'Enter / o Open · i AliceProjects · p Setup · r Restart · x Stop'
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
  recovery = false,
): string {
  if (recovery) return configRecoveryBlockedNotice()
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
    'apply-update': 'Installing update',
  }[action]
}

function primaryAction(
  runtime: RuntimeSummary | null,
): SupervisorAction | undefined {
  if (runtime?.class === 'absent') return 'start-open'
  if (runtime?.endpoints?.web) return 'open'
  return undefined
}

function formatUpdateNotice(
  update: UpdateResult,
  kind: 'check' | 'discover' = 'check',
): string {
  if (update.status === 'available') {
    const version = update.latestVersion ?? 'update'
    return kind === 'discover'
      ? `OpenAlice ${version} is available; press u to review and install it.`
      : `OpenAlice ${version} is available. Confirm below to install it now.`
  }
  if (update.status === 'current') {
    return `OpenAlice ${update.currentVersion ?? ''} is current.`.trim()
  }
  return update.message ?? 'Automatic update is unavailable for this install channel.'
}

function formatUpdateInstalledNotice(update: UpdateResult): string {
  const version = update.latestVersion ?? 'the new OpenAlice'
  return `Installed ${version}. This running Supervisor is still the previous CLI and did not reload. Press q to detach, then run openalice again.`
}

function isConfigRecovery(snapshot: SupervisorSnapshot): boolean {
  return snapshot.mode === 'config-recovery'
}

function hasExplicitProjectOrHomeFlags(flags: TuiLaunchFlags): boolean {
  return flags.project !== undefined
    || flags.instance !== undefined
    || flags.home !== undefined
}

function hasExplicitProjectOrHomeSelection(
  flags: TuiLaunchFlags,
  env: NodeJS.ProcessEnv,
): boolean {
  return hasExplicitProjectOrHomeFlags(flags)
    || env['OPENALICE_PROJECT'] !== undefined
    || env['OPENALICE_INSTANCE'] !== undefined
    || env['OPENALICE_HOME'] !== undefined
}

function configRecoveryNotice(error: unknown): string {
  return isNewerSupervisorSchemaError(error)
    ? 'AliceProject configuration requires a newer OpenAlice and cannot be read by this CLI. This shell will not inspect, start, or configure a project. Press u to check for and install an update, then exit and run openalice again.'
    : 'AliceProject configuration cannot be read. It may be corrupt or require a newer OpenAlice. This shell will not inspect, start, or configure a project. Press u to check for and install an update, or repair the Supervisor config.'
}

function configRecoveryBlockedNotice(): string {
  return 'AliceProject configuration cannot be used. This Supervisor will not inspect, start, open, stop, restart, or configure a guessed project.'
}

async function applyVerifiedSupervisorUpdate(
  result: UpdateResult,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const layout = resolveInstalledLayout(import.meta.url)
  if (!layout) {
    throw new Error(
      'This OpenAlice CLI is running from source, not an installed release. Re-run the public installer to update the installed command.',
    )
  }
  if (
    result.status !== 'available'
    || typeof result.latestVersion !== 'string'
    || typeof result.installer?.versionedUrl !== 'string'
    || typeof result.installer.sha256 !== 'string'
  ) {
    throw new Error('Update metadata is incomplete. Press u to check again.')
  }
  return downloadAndRunInstaller(result, {
    layout,
    yes: true,
    env: options.env ?? process.env,
    spawnImpl: createSupervisorUpdateSpawn(),
  })
}

function createSupervisorUpdateSpawn() {
  return (
    command: string,
    args: readonly string[],
    options: Record<string, unknown>,
  ) => {
    const child = spawn(command, [...args], {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.resume()
    child.stderr?.resume()
    return child
  }
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
  const projectLock = settingOverrideLock(context.provenance.project)
  if (projectLock) return `AliceProject selection is read-only. ${projectLock}`
  const homeLock = settingOverrideLock(context.provenance.home)
  if (homeLock) {
    return `AliceProject selection is read-only while this session's complete home is fixed. ${homeLock}`
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
  fallbackProject: string,
): string {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/for AliceProject "([^"]+)" (is missing|is unavailable or not writable)/)
  const unavailable = match
    ? `AliceProject "${match[1]}" ${match[2]}.`
    : 'The remembered AliceProject home is unavailable.'
  return sanitize(
    `${unavailable} Using "${fallbackProject}"; press i AliceProjects to recover.`,
  )
}

function sanitize(value: string): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function loopbackEndpointPort(value: string | null): number | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null
    const port = Number(url.port || '80')
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

function remoteHomesOverlap(left: string, right: string): boolean {
  const leftPath = posix.normalize(left)
  const rightPath = posix.normalize(right)
  const leftRelative = posix.relative(leftPath, rightPath)
  const rightRelative = posix.relative(rightPath, leftPath)
  return leftRelative === ''
    || (!leftRelative.startsWith('../') && leftRelative !== '..')
    || (!rightRelative.startsWith('../') && rightRelative !== '..')
}

function formatTransferProgress(bytes: number, total: number): string {
  if (total <= 0) return '0 B'
  const percent = Math.min(100, Math.floor((bytes / total) * 100))
  return `${percent}% · ${bytes}/${total} bytes`
}

async function runRemoteProjectStart(
  machine: RegisteredMachine,
  projectKey: string,
): Promise<void> {
  if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(projectKey)) throw new Error('Invalid remote AliceProject key.')
  const command = `set -eu
cli=$(command -v openalice 2>/dev/null || { [ ! -x "$HOME/.openalice/bin/openalice" ] || printf '%s\\n' "$HOME/.openalice/bin/openalice"; })
[ -n "$cli" ] || exit 127
exec "$cli" up --project ${projectKey} --wait 30`
  const child = spawn('ssh', buildRemoteSshArgs({
    destination: machine.sshTarget,
    sshPort: machine.sshPort ?? null,
    identityFile: machine.identityFile ?? null,
  }, command), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4_096) })
  await new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Remote start failed ${signal ? `with ${signal}` : `with code ${code ?? 'unknown'}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
    })
  })
}

function alignLocalFleetProject(
  machines: MachineInventory[],
  context: ResolvedLaunchContext | undefined,
  runtime: RuntimeSummary | null,
): MachineInventory[] {
  if (!context) return machines
  return machines.map((machine) => {
    if (machine.key !== 'local') return machine
    const existing = machine.projects.find((project) => project.key === context.project)
    const projected: MachineProjectInventory = {
      key: context.project,
      id: context.aliceProject.id,
      displayName: context.aliceProject.displayName,
      home: context.home,
      port: context.port,
      portAutomatic: context.provenance.port.source === 'default',
      product: existing?.product ?? 'trader',
      isDefault: existing?.isDefault ?? false,
      available: existing?.available ?? true,
      runtime: {
        class: runtime?.class ?? 'unavailable',
        state: runtime?.state ?? 'unknown',
        ownerSurface: runtime?.owner?.surface ?? null,
        uptimeSeconds: Number.isFinite(runtime?.uptimeSeconds)
          ? runtime?.uptimeSeconds ?? null
          : null,
        webEndpoint: runtime?.endpoints?.web ?? null,
        components: Object.fromEntries(
          Object.entries(runtime?.components ?? {})
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        ),
      },
    }
    return {
      ...machine,
      projects: existing
        ? machine.projects.map((project) => project.key === context.project ? projected : project)
        : [...machine.projects, projected],
    }
  })
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
