import { spawn } from 'node:child_process'
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
import { CLI_VERSION, readInstallSource } from './install-source.mjs'
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
  createSupervisorTerminalCanvas,
  parseSupervisorPointer,
  type SupervisorPointerEvent,
} from './supervisor-tui-pointer.ts'
import {
  SupervisorOverlayPointerRouter,
  supervisorVisibleListIndexes,
  type SupervisorOverlayListTarget,
  type SupervisorOverlayOptions,
} from './supervisor-overlay-pointer.ts'
import {
  renderSupervisorConfirmation,
  SUPERVISOR_CONFIRMATION_OVERLAY_OPTIONS,
  type SupervisorConfirmation,
  type SupervisorConfirmationView,
} from './supervisor-confirmation.ts'
import {
  createSupervisorCommandDeckState,
  decorateSupervisorCommandDeck,
  filterSupervisorCommandDeckItems,
  moveSupervisorCommandDeckSelection,
  normalizeSupervisorCommandDeckState,
  renderSupervisorCommandDeck,
  SUPERVISOR_COMMAND_PALETTE_OVERLAY_OPTIONS,
  supervisorCommandDeckItems,
  type SupervisorCommandDeckItem,
  type SupervisorCommandDeckState,
} from './supervisor-command-deck.ts'
import {
  createSupervisorTuiTheme,
  decorateSupervisorFrame,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
import {
  decorateSupervisorSetupStudio,
  decorateSupervisorSetupWorkbench,
  renderSupervisorSetupStudio,
  renderSupervisorSetupWorkbench,
  supervisorSetupWorkbenchFieldWidth,
  type SupervisorSetupItem,
} from './supervisor-setup-view.ts'
import {
  decorateSupervisorProjectSwitchboard,
  renderSupervisorProjectSwitchboard,
  type SupervisorProjectSwitchboardItem,
} from './supervisor-projects-view.ts'
import {
  decorateSupervisorProjectFoundry,
  renderSupervisorProjectFoundry,
  supervisorProjectFoundryFieldWidth,
  type SupervisorProjectFoundryView,
} from './supervisor-project-foundry-view.ts'
import {
  decorateSupervisorSourceLaunchBay,
  renderSupervisorSourceLaunchBay,
  supervisorSourceFieldWidth,
  type SupervisorSourcePhase,
} from './supervisor-source-view.ts'
import {
  decorateSupervisorReleaseObservatory,
  renderSupervisorReleaseObservatory,
} from './supervisor-release-view.ts'
import {
  createSupervisorHelpState,
  moveSupervisorHelpSelection,
  normalizeSupervisorHelpState,
  renderSupervisorHelp,
  selectSupervisorHelpBoundary,
  type SupervisorHelpState,
  type SupervisorHelpTarget,
} from './supervisor-help-view.ts'
import {
  renderSupervisorNavigation,
  supervisorNavigationPanelAt,
  type SupervisorNavigationTarget,
} from './supervisor-navigation.ts'
import {
  renderSupervisorActivitySlot,
  supervisorMotionEnabled,
} from './supervisor-tui-feedback.ts'
import {
  nextSupervisorLogFilter,
  renderSupervisorLogs,
  supervisorFilteredLogCount,
  supervisorLogFilterLabel,
  type SupervisorLogFilter,
  type SupervisorLogTarget,
  type SupervisorRuntimeLogs as RuntimeLogs,
} from './supervisor-tui-logs.ts'
import {
  createSupervisorDoctorState,
  moveSupervisorDoctorSelection,
  normalizeSupervisorDoctorState,
  renderSupervisorDoctor,
  selectSupervisorDoctorBoundary,
  type SupervisorDoctorReport as DoctorReport,
  type SupervisorDoctorState,
  type SupervisorDoctorTarget,
} from './supervisor-doctor-view.ts'
import {
  renderSupervisorCommandBar,
  renderSupervisorDock,
  renderSupervisorHeaderLayout,
  renderSupervisorHome,
  renderSupervisorPanel,
  supervisorCommandTargets,
  type SupervisorCommandTarget,
  type SupervisorHomeTarget,
} from './supervisor-tui-view.ts'
import { connectSsh } from './ssh-connect.mjs'
import { buildRemoteSshArgs } from './remote.mjs'
import { planProjectTransfer, type ProjectTransferPlan } from './project-transfer.ts'
import { transferProjectOverSsh } from './project-transfer-ssh.ts'
import type { ProjectTransferReceipt } from './project-transfer-stream.ts'
import {
  createSupervisorFleetState,
  displayWidth,
  fleetTunnelKey,
  moveFleetSelection,
  renderSupervisorFleet,
  replaceFleetInventory,
  selectFleetIndex,
  selectedFleetMachine,
  selectedFleetProject,
  selectFleetProjectByKey,
  setFleetFocus,
  supervisorFleetTargetAt,
  type SupervisorFleetPointerTarget,
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
  decorateSupervisorTransferFlightDeck,
  renderSupervisorTransferArrival,
  renderSupervisorTransferChoice,
  renderSupervisorTransferFlightDeck,
  renderSupervisorTransferInput,
  renderSupervisorTransferPlanning,
  renderSupervisorTransferProgress,
  renderSupervisorTransferRecovery,
  renderSupervisorTransferReview,
} from './supervisor-transfer-view.ts'
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
  normalizeUpdateChannel,
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

interface UpdateResult {
  status?: string
  currentVersion?: string
  latestVersion?: string
  latestCommit?: string
  latestContentIdentity?: string
  latestArtifactSha256?: string
  message?: string
  releaseNotesUrl?: string
  channel?: SupervisorUpdateChannel
  sourceChannel?: string
  packageManager?: {
    label?: string
    update?: string
  }
  installer?: {
    url?: string
    versionedUrl?: string
    sha256?: string
  }
}

export type SupervisorUpdateChannel = 'stable' | 'beta' | 'dev'

export type SupervisorPanel = 'fleet' | 'overview' | 'logs' | 'doctor' | 'help'

interface SupervisorNavigationTransition {
  from: SupervisorPanel
  fromColumn?: number
  to: SupervisorPanel
  frame: number
}
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
export type { SupervisorConfirmation } from './supervisor-confirmation.ts'

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
  initialPanel?: SupervisorPanel
  inspect?: (options?: { homeRoot?: string; waitMs?: number }) => Promise<RuntimeSummary>
  start?: (options: Record<string, unknown>) => Promise<unknown>
  stop?: (options: Record<string, unknown>) => Promise<unknown>
  open?: (options: Record<string, unknown>) => Promise<unknown>
  readLogs?: (options: Record<string, unknown>) => Promise<RuntimeLogs>
  diagnose?: (options: Record<string, unknown>) => Promise<DoctorReport>
  checkUpdate?: (channel: SupervisorUpdateChannel) => Promise<UpdateResult>
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
  const resolvedChannel = dependencies.channel
    ?? await (dependencies.resolveChannel ?? resolveSupervisorChannel)()
  const channel = normalizeSupervisorUpdateChannel(resolvedChannel) ?? 'stable'
  const terminal = new piTui.ProcessTerminal()
  const ui = new piTui.TUI(
    terminal,
    undefined,
    join(supervisorRoot, 'logs'),
  )
  const canvas = createSupervisorTerminalCanvas(stdout, dependencies.env ?? process.env)
  const overlayPointer = new SupervisorOverlayPointerRouter()
  const tuiTheme = createSupervisorTuiTheme(dependencies.env ?? process.env)
  const plainTuiTheme = createSupervisorTuiTheme({ NO_COLOR: '1' })
  const motionEnabled = supervisorMotionEnabled(dependencies.env ?? process.env)
  let active = true
  let actionRunning = false
  let sourcePromptActive = false
  let settingsActive = false
  let projectsActive = false
  let transferActive = false
  let updateChannelActive = false
  let confirmationActive = false
  let commandPaletteActive = false
  let fleetRefreshing = false
  const tunnelControllers = new Map<string, AbortController>()
  let managedStartAction: 'start' | 'start-open' = 'start'
  let closeSourcePrompt: (() => void) | null = null
  let closeSettings: (() => void) | null = null
  let closeProjects: (() => void) | null = null
  let closeTransfer: (() => void) | null = null
  let closeUpdateChannel: (() => void) | null = null
  let closeConfirmation: (() => void) | null = null
  let closeCommandPalette: (() => void) | null = null
  let motionTimer: NodeJS.Timeout | undefined
  let screen: SupervisorScreen
  const terminalSize = () => ({
    width: stdout.columns ?? 80,
    height: stdout.rows ?? 24,
  })
  const captureOverlayPointer = (
    lines: string[],
    width: number,
    options: SupervisorOverlayOptions,
    input: (data: string) => void,
    list?: SupervisorOverlayListTarget,
    hoverCommand?: (label?: string) => void,
  ) => {
    const terminal = terminalSize()
    overlayPointer.capture({
      lines,
      width,
      terminalWidth: terminal.width,
      terminalHeight: terminal.height,
      options,
      input,
      list,
      hoverCommand,
    })
  }
  const selectListPointerTarget = (
    items: SelectItem[],
    list: {
      getSelectedItem(): SelectItem | null
      setSelectedIndex(index: number): void
      handleInput(data: string): void
    },
    maxVisible: number,
    firstRow: number,
  ): SupervisorOverlayListTarget => {
    const selected = list.getSelectedItem()
    const selectedIndex = Math.max(0, items.findIndex((item) => item.value === selected?.value))
    return {
      firstRow,
      indexes: supervisorVisibleListIndexes(selectedIndex, items.length, maxVisible),
      select(index) {
        list.setSelectedIndex(index)
        ui.requestRender()
      },
      activate() {
        list.handleInput('\r')
      },
      move(delta) {
        list.handleInput(delta < 0 ? '\u001b[A' : '\u001b[B')
        ui.requestRender()
      },
    }
  }
  const stopMotionTimer = () => {
    if (motionTimer) clearInterval(motionTimer)
    motionTimer = undefined
  }
  const syncMotionTimer = () => {
    if (!motionEnabled || !screen.hasActiveMotion()) {
      stopMotionTimer()
      return
    }
    if (motionTimer) return
    motionTimer = setInterval(() => {
      if (screen.advanceMotion()) ui.requestRender()
      if (!screen.hasActiveMotion()) stopMotionTimer()
    }, 80)
    motionTimer.unref()
  }

  function syncConfirmationOverlay(action?: SupervisorConfirmation): void {
    closeConfirmation?.()
    if (!action) return

    confirmationActive = true
    let hoveredCommand: string | undefined
    const view = confirmationView(
      action,
      screen.snapshot.runtime,
      screen.snapshot.managedSource,
      screen.snapshot.update,
    )
    const panel = new (class implements Component {
      render(width: number): string[] {
        const plainLines = renderSupervisorConfirmation(
          view,
          width,
          plainTuiTheme,
        )
        captureOverlayPointer(
          plainLines,
          width,
          SUPERVISOR_CONFIRMATION_OVERLAY_OPTIONS,
          (data) => this.handleInput(data),
          undefined,
          (label) => {
            if (hoveredCommand === label) return
            hoveredCommand = label
            ui.requestRender()
          },
        )
        return renderSupervisorConfirmation(view, width, tuiTheme, hoveredCommand)
      }

      handleInput(data: string): void {
        if (piTui.matchesKey(data, 'escape')) {
          screen.cancelConfirmation()
          return
        }
        screen.handleKey(data, piTui.matchesKey)
      }

      invalidate(): void {}
    })()
    const overlay = ui.showOverlay(panel, SUPERVISOR_CONFIRMATION_OVERLAY_OPTIONS)
    closeConfirmation = () => {
      if (!confirmationActive) return
      confirmationActive = false
      closeConfirmation = null
      hoveredCommand = undefined
      overlayPointer.clear()
      overlay.hide()
    }
    overlay.focus()
  }

  function syncCommandPaletteOverlay(open: boolean): void {
    closeCommandPalette?.()
    if (!open) return

    commandPaletteActive = true
    const panel = new (class implements Component {
      render(width: number): string[] {
        const deck = screen.renderCommandPalette(width)
        captureOverlayPointer(
          deck.lines,
          width,
          SUPERVISOR_COMMAND_PALETTE_OVERLAY_OPTIONS,
          (data) => this.handleInput(data),
          {
            firstRow: deck.targets[0]?.row ?? 3,
            indexes: deck.targets.map((target) => target.index),
            select: (index) => screen.selectCommandPaletteItem(index),
            activate: () => screen.activateCommandPaletteItem(),
            move: (delta) => screen.moveCommandPaletteSelection(delta),
          },
        )
        return decorateSupervisorCommandDeck(deck.lines, tuiTheme)
      }

      handleInput(data: string): void {
        if (piTui.matchesKey(data, 'escape')) screen.handleEscape()
        else screen.handleKey(data, piTui.matchesKey)
      }

      invalidate(): void {}
    })()
    const overlay = ui.showOverlay(panel, SUPERVISOR_COMMAND_PALETTE_OVERLAY_OPTIONS)
    closeCommandPalette = () => {
      if (!commandPaletteActive) return
      commandPaletteActive = false
      closeCommandPalette = null
      overlayPointer.clear()
      overlay.hide()
    }
    overlay.focus()
  }

  screen = new SupervisorScreen({
    version: dependencies.version ?? readCliVersion(),
    channel,
    panel: dependencies.initialPanel ?? 'overview',
    runtime,
    context,
    mode: configRecovery ? 'config-recovery' : 'normal',
    recoveryReason,
    diagnostic,
    notice: startupNotice,
    fleet,
  }, {
    onAction: (action) => {
      if (action === 'update') openUpdateChannelPicker()
      else void requestAction(action)
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
    onConfirmationChange: syncConfirmationOverlay,
    onCommandPaletteChange: syncCommandPaletteOverlay,
    requestRender: () => ui.requestRender(),
    theme: tuiTheme,
    motionEnabled,
    onMotionDemandChange: syncMotionTimer,
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
          ? replaceFleetInventory(
              currentFleet,
              currentFleet.generatedAt,
              alignLocalFleetProject(
                currentFleet.machines,
                context,
                nextRuntime,
              ),
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

  function openUpdateChannelPicker(): void {
    if (
      updateChannelActive
      || sourcePromptActive
      || settingsActive
      || projectsActive
      || transferActive
      || actionRunning
    ) return
    updateChannelActive = true
    let updateChannelHoveredCommand: string | undefined
    const items: SelectItem[] = [
      {
        value: 'stable',
        label: 'Stable',
        description: 'Production releases only.',
      },
      {
        value: 'beta',
        label: 'Beta',
        description: 'The latest accepted beta release.',
      },
      {
        value: 'dev',
        label: 'Dev',
        description: 'The latest native CLI built from the dev branch.',
      },
    ]
    const theme: SelectListTheme = {
      selectedPrefix: (text) => tuiTheme.accentStrong(text),
      selectedText: (text) => tuiTheme.selected(text),
      description: (text) => tuiTheme.muted(text),
      scrollInfo: (text) => tuiTheme.muted(text),
      noMatch: (text) => tuiTheme.warning(text),
    }
    const list = new piTui.SelectList(items, items.length, theme)
    list.setSelectedIndex(Math.max(
      0,
      items.findIndex((item) => item.value === screen.snapshot.channel),
    ))
    const overlayOptions = {
      width: '90%',
      maxHeight: '90%',
      anchor: 'center',
      margin: 1,
    } as const
    const close = (notice?: string) => {
      if (!updateChannelActive) return
      updateChannelActive = false
      closeUpdateChannel = null
      overlayPointer.clear()
      updateChannelHoveredCommand = undefined
      overlay.unfocus?.({ target: screen })
      overlay.hide()
      if (notice) screen.update({ notice })
    }
    list.onCancel = () => close('Update channel unchanged.')
    list.onSelect = (item) => {
      const selected = normalizeSupervisorUpdateChannel(item.value)
      if (!selected) return
      close()
      screen.update({
        channel: selected,
        update: null,
        confirmation: undefined,
      })
      void performAction('update')
    }
    const panel = new (class implements Component {
      render(width: number): string[] {
        const selectedItem = list.getSelectedItem()
        const selectedIndex = Math.max(0, items.findIndex((item) => item.value === selectedItem?.value))
        const observatory = renderSupervisorReleaseObservatory({
          installedVersion: screen.snapshot.version,
          currentLane: normalizeSupervisorUpdateChannel(screen.snapshot.channel) ?? 'stable',
          selected: selectedIndex,
        }, width)
        const baseList = selectListPointerTarget(
          items,
          list,
          items.length,
          observatory.targets[0]?.row ?? 2,
        )
        const firstTarget = observatory.targets[0]
        const listTarget: SupervisorOverlayListTarget = {
          ...baseList,
          indexes: observatory.targets.map((target) => target.index),
          startColumn: firstTarget?.startColumn ?? 2,
          endColumn: firstTarget?.endColumn ?? Math.max(2, width - 1),
          select: (index) => {
            updateChannelHoveredCommand = undefined
            list.setSelectedIndex(index)
            list.invalidate()
            ui.requestRender()
          },
          move: (delta) => {
            updateChannelHoveredCommand = undefined
            baseList.move(delta)
          },
          activate: () => undefined,
        }
        captureOverlayPointer(
          observatory.lines,
          width,
          overlayOptions,
          (data) => this.handleInput(data),
          listTarget,
          (label) => {
            if (updateChannelHoveredCommand === label) return
            updateChannelHoveredCommand = label
            ui.requestRender()
          },
        )
        return decorateSupervisorReleaseObservatory(
          observatory.lines,
          tuiTheme,
          updateChannelHoveredCommand,
        )
      }

      handleInput(data: string): void {
        updateChannelHoveredCommand = undefined
        list.handleInput(data)
      }

      invalidate(): void {
        list.invalidate()
      }
    })()
    const overlay = ui.showOverlay(panel, overlayOptions)
    closeUpdateChannel = () => close()
    overlay.focus()
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
        const update = await services.checkUpdate(
          normalizeSupervisorUpdateChannel(screen.snapshot.channel) ?? 'stable',
        )
        screen.update({
          update,
          notice: formatUpdateNotice(update),
          confirmation: update.status === 'available' && !update.packageManager
            ? 'update'
            : undefined,
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
      || updateChannelActive
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
    let phase: SupervisorSourcePhase = 'select'
    let sourceHoveredCommand: string | undefined
    const overlayOptions = {
      width: '92%',
      maxHeight: 20,
      anchor: 'center',
      margin: 1,
    } as const
    const input = new (class extends piTui.Input {
      detail = reason
        ? `Start needs an OpenAlice source checkout. ${reason}`
        : 'Choose the OpenAlice source checkout for this AliceProject.'

      setDetail(detail: string, nextPhase: SupervisorSourcePhase = phase): void {
        this.detail = detail
        phase = nextPhase
        this.invalidate()
        ui.requestRender()
      }

      override render(width: number): string[] {
        const launchBay = renderSupervisorSourceLaunchBay({
          phase,
          projectName: sourceContext.aliceProject.displayName,
          provenance: sourceContext.provenance.appDir.source,
          fieldLines: super.render(supervisorSourceFieldWidth(width)),
          detail: sanitize(this.detail),
          contract: 'Validate the checkout before saving; launch only follows a saved source.',
        }, width)
        captureOverlayPointer(
          launchBay.lines,
          width,
          overlayOptions,
          (data) => this.handleInput(data),
          undefined,
          (label) => {
            if (sourceHoveredCommand === label) return
            sourceHoveredCommand = label
            ui.requestRender()
          },
        )
        return decorateSupervisorSourceLaunchBay(
          launchBay.lines,
          tuiTheme,
          sourceHoveredCommand,
        )
      }

      override handleInput(data: string): void {
        sourceHoveredCommand = undefined
        super.handleInput(data)
      }
    })()
    input.setValue(sourceContext.appDir ?? process.cwd())
    input.handleInput('\u0005')
    const overlay = ui.showOverlay(input, overlayOptions)
    ui.setShowHardwareCursor(true)

    const close = (notice?: string) => {
      if (!sourcePromptActive) return
      sourcePromptActive = false
      closeSourcePrompt = null
      overlayPointer.clear()
      sourceHoveredCommand = undefined
      overlay.unfocus?.({ target: screen })
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
        input.setDetail('Enter a source checkout path.', 'error')
        return
      }
      saving = true
      input.setDetail('Validating the checkout before saving or launching…', 'validating')
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
          input.setDetail(`Could not use that checkout: ${safeError(error)}`, 'error')
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
      || updateChannelActive
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
    let settingsSelectedIndex = 0
    let settingsSubmenuOpen = false
    let activeSettingsInput: Component | null = null
    let settingsHoveredCommand: string | undefined
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
      overlayPointer.clear()
      settingsSubmenuOpen = false
      activeSettingsInput = null
      settingsHoveredCommand = undefined
      overlay.unfocus?.({ target: screen })
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
        phase: 'edit' | 'error' = 'edit'

        setDetail(next: string): void {
          this.detail = next
          this.phase = 'error'
          this.invalidate()
          ui.requestRender()
        }

        override render(width: number): string[] {
          return renderSupervisorSetupWorkbench({
            phase: this.phase,
            projectName: settingsContext.aliceProject.displayName,
            scope,
            fieldTitle: title,
            fieldPosition: `${settingsSelectedIndex + 1}/${items.length}`,
            runtimeClass: screen.snapshot.runtime?.class,
            fieldLines: super.render(supervisorSetupWorkbenchFieldWidth(width)),
            detail: sanitize(this.detail),
            message: scope === MACHINE_SCOPE
              ? 'Blank values fall through to OpenAlice defaults; AliceProject overrides remain above.'
              : 'Blank values inherit from Machine defaults; environment and command-line overrides remain above.',
          }, width)
        }
      })()
      input.setValue(initialValue)
      input.focused = true
      activeSettingsInput = input
      ui.setShowHardwareCursor(true)
      input.onEscape = () => {
        input.focused = false
        activeSettingsInput = null
        ui.setShowHardwareCursor(false)
        settingsSubmenuOpen = false
        done()
      }
      input.onSubmit = (value) => {
        const validation = validate(value.trim())
        if (validation) {
          input.setDetail(validation)
          return
        }
        input.focused = false
        activeSettingsInput = null
        ui.setShowHardwareCursor(false)
        settingsSubmenuOpen = false
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
      label: (text) => tuiTheme.accentStrong(text),
      value: (text) => tuiTheme.accent(text),
      description: (text) => tuiTheme.muted(text),
      cursor: tuiTheme.accentStrong('› '),
      hint: (text) => tuiTheme.muted(text),
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
    const moveSettings = (delta: -1 | 1) => {
      settingsHoveredCommand = undefined
      settingsSelectedIndex = delta < 0
        ? settingsSelectedIndex === 0 ? items.length - 1 : settingsSelectedIndex - 1
        : settingsSelectedIndex === items.length - 1 ? 0 : settingsSelectedIndex + 1
      settings.handleInput(delta < 0 ? '\u001b[A' : '\u001b[B')
    }
    const handleSettingsInput = (data: string) => {
      if (saving) return
      settingsHoveredCommand = undefined
      if (settingsSubmenuOpen && activeSettingsInput) {
        activeSettingsInput.handleInput?.(data)
        return
      }
      if (!settingsSubmenuOpen) {
        if (piTui.matchesKey(data, 'up')) {
          moveSettings(-1)
          return
        } else if (piTui.matchesKey(data, 'down')) {
          moveSettings(1)
          return
        } else if (
          (piTui.matchesKey(data, 'enter') || data === ' ')
          && items[settingsSelectedIndex]?.submenu
        ) {
          settingsSubmenuOpen = true
        }
      }
      settings.handleInput(data)
    }
    const overlayOptions = {
      width: '90%',
      maxHeight: '90%',
      anchor: 'center',
      margin: 1,
    } as const
    const panel = new (class implements Component {
      render(width: number): string[] {
        if (settingsSubmenuOpen) {
          const lines = settings.render(width)
          captureOverlayPointer(
            lines,
            width,
            overlayOptions,
            (data) => this.handleInput(data),
            undefined,
            (label) => {
              if (settingsHoveredCommand === label) return
              settingsHoveredCommand = label
              ui.requestRender()
            },
          )
          return decorateSupervisorSetupWorkbench(
            lines,
            tuiTheme,
            settingsHoveredCommand,
          )
        }
        const studioItems: SupervisorSetupItem[] = items.map((item) => ({
          id: item.id,
          label: item.label,
          value: sanitize(item.currentValue),
          description: sanitize(item.description ?? 'No additional setup guidance is available.'),
          kind: item.submenu ? 'editor' : item.values?.length ? 'choice' : 'readonly',
        }))
        const studio = renderSupervisorSetupStudio({
          projectName: settingsContext.aliceProject.displayName,
          scope: scope === MACHINE_SCOPE ? 'Machine defaults' : 'AliceProject',
          runtimeClass: screen.snapshot.runtime?.class,
          message: sanitize(message),
          items: studioItems,
          selected: settingsSelectedIndex,
        }, width)
        const firstTarget = studio.targets[0]
        const list = {
          firstRow: firstTarget?.row ?? 2,
          indexes: studio.targets.map((target) => target.index),
          startColumn: firstTarget?.startColumn ?? 2,
          endColumn: firstTarget?.endColumn ?? Math.max(2, width - 1),
          select: (index: number) => {
            while (settingsSelectedIndex !== index) moveSettings(1)
            settingsHoveredCommand = undefined
            ui.requestRender()
          },
          activate: () => handleSettingsInput('\r'),
          move: (delta: -1 | 1) => {
            moveSettings(delta)
            ui.requestRender()
          },
        }
        captureOverlayPointer(
          studio.lines,
          width,
          overlayOptions,
          (data) => this.handleInput(data),
          list,
          (label) => {
            if (settingsHoveredCommand === label) return
            settingsHoveredCommand = label
            ui.requestRender()
          },
        )
        return decorateSupervisorSetupStudio(studio.lines, tuiTheme, settingsHoveredCommand)
      }

      handleInput(data: string): void {
        handleSettingsInput(data)
      }

      invalidate(): void {
        settings.invalidate()
      }
    })()
    const overlay = ui.showOverlay(panel, overlayOptions)
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
      || updateChannelActive
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
    let projectsHoveredCommand: string | undefined
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
    const switchboardItems: SupervisorProjectSwitchboardItem[] = visibleInstances.map((entry) => ({
      key: entry.key,
      label: entry.displayName,
      kind: 'project',
      home: entry.home,
      port: entry.port,
      portAutomatic: entry.portAutomatic,
      current: entry.key === projectContext.project,
      isDefault: entry.isDefault,
    }))
    if (!lock) {
      switchboardItems.push({
        key: createValue,
        label: '+ Create AliceProject…',
        kind: 'create',
      })
    }

    const theme: SelectListTheme = {
      selectedPrefix: (text) => tuiTheme.accentStrong(text),
      selectedText: (text) => tuiTheme.selected(text),
      description: (text) => tuiTheme.muted(text),
      scrollInfo: (text) => tuiTheme.muted(text),
      noMatch: (text) => tuiTheme.warning(text),
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
    let projectListActive = true
    let creatorView: Omit<SupervisorProjectFoundryView, 'fieldLines'> | null = null
    const overlayOptions = {
      width: '92%',
      maxHeight: '90%',
      anchor: 'center',
      margin: 1,
    } as const

    const setMessage = (next: string) => {
      message = next
      ui.requestRender()
    }
    const close = (notice = 'AliceProject selection closed.') => {
      if (!projectsActive) return
      projectsActive = false
      closeProjects = null
      overlayPointer.clear()
      projectsHoveredCommand = undefined
      overlay.unfocus?.({ target: screen })
      overlay.hide()
      ui.setShowHardwareCursor(false)
      screen.update({ notice })
    }
    const showList = () => {
      ui.setShowHardwareCursor(false)
      component = list
      projectListActive = true
      creatorView = null
      projectsHoveredCommand = undefined
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
      projectListActive = false
      const defaultHome = registry.projects.find(
        (entry) => entry.key === 'default',
      )?.home ?? projectContext.home
      const suggestedHome = join(
        dirname(defaultHome),
        `.openalice-${name}`,
      )
      const input = new (class extends piTui.Input {
        detail = 'Use a separate complete home; empty paths are prepared.'

        setDetail(next: string): void {
          this.detail = next
          if (creatorView?.step === 'home' && creatorView.projectKey === name) {
            creatorView = { ...creatorView, detail: next }
          }
          this.invalidate()
          ui.requestRender()
        }

        override render(width: number): string[] {
          return super.render(width)
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
      creatorView = {
        step: 'home',
        currentProjectName: projectContext.aliceProject.displayName,
        projectKey: name,
        detail: sanitize(input.detail),
        message: 'The new AliceProject owns only its registry entry; existing data is never copied or deleted.',
      }
      setMessage('The new AliceProject owns only its registry entry; existing data is never copied or deleted.')
    }
    const showCreateNameInput = () => {
      projectListActive = false
      const input = new (class extends piTui.Input {
        detail = 'Use a short lowercase name such as research or paper.'

        setDetail(next: string): void {
          this.detail = next
          if (creatorView?.step === 'identity') {
            creatorView = { ...creatorView, detail: next }
          }
          this.invalidate()
          ui.requestRender()
        }

        override render(width: number): string[] {
          return super.render(width)
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
      creatorView = {
        step: 'identity',
        currentProjectName: projectContext.aliceProject.displayName,
        detail: sanitize(input.detail),
        message: 'Create a named AliceProject without leaving the Supervisor.',
      }
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
        if (!projectListActive) {
          if (!creatorView) return []
          const foundry = renderSupervisorProjectFoundry({
            ...creatorView,
            detail: sanitize(creatorView.detail),
            message: sanitize(message),
            fieldLines: component.render(supervisorProjectFoundryFieldWidth(width)),
          }, width)
          captureOverlayPointer(
            foundry.lines,
            width,
            overlayOptions,
            (data) => this.handleInput(data),
            undefined,
            (label) => {
              if (projectsHoveredCommand === label) return
              projectsHoveredCommand = label
              ui.requestRender()
            },
          )
          return decorateSupervisorProjectFoundry(
            foundry.lines,
            tuiTheme,
            projectsHoveredCommand,
          )
        }
        const selectedItem = list.getSelectedItem()
        const activeIndex = Math.max(0, items.findIndex((item) => item.value === selectedItem?.value))
        const switchboard = renderSupervisorProjectSwitchboard({
          currentProjectName: projectContext.aliceProject.displayName,
          message: sanitize(message),
          locked: Boolean(lock),
          items: switchboardItems,
          selected: activeIndex,
          maxVisible: width >= 92
            ? 8
            : Math.max(1, Math.min(5, Math.floor(terminalSize().height * 0.9) - 16)),
        }, width)
        const baseList = selectListPointerTarget(items, list, 8, switchboard.targets[0]?.row ?? 2)
        const firstTarget = switchboard.targets[0]
        const listTarget: SupervisorOverlayListTarget = {
          ...baseList,
          indexes: switchboard.targets.map((target) => target.index),
          startColumn: firstTarget?.startColumn ?? 2,
          endColumn: firstTarget?.endColumn ?? Math.max(2, width - 1),
          select: (index) => {
            projectsHoveredCommand = undefined
            baseList.select(index)
          },
          move: (delta) => {
            projectsHoveredCommand = undefined
            baseList.move(delta)
          },
        }
        captureOverlayPointer(
          switchboard.lines,
          width,
          overlayOptions,
          (data) => this.handleInput(data),
          listTarget,
          (label) => {
            if (projectsHoveredCommand === label) return
            projectsHoveredCommand = label
            ui.requestRender()
          },
        )
        return decorateSupervisorProjectSwitchboard(
          switchboard.lines,
          tuiTheme,
          projectsHoveredCommand,
        )
      }

      handleInput(data: string): void {
        if (!changing) {
          projectsHoveredCommand = undefined
          component.handleInput?.(data)
        }
      }

      invalidate(): void {
        component.invalidate()
      }
    })()
    const overlay = ui.showOverlay(panel, overlayOptions)
    closeProjects = () => close()
    overlay.focus()
  }

  async function openTransferWizard(source: MachineProjectInventory): Promise<void> {
    if (transferActive || sourcePromptActive || settingsActive || projectsActive || updateChannelActive || actionRunning) return
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
    let activeChoice: {
      items: SelectItem[]
      list: InstanceType<typeof piTui.SelectList>
      maxVisible: number
    } | null = null
    let message = 'Choose the SSH Machine that will own the new AliceProject.'
    let transferController: AbortController | null = null
    let transferHoveredCommand: string | undefined
    const theme: SelectListTheme = {
      selectedPrefix: (text) => tuiTheme.accentStrong(text),
      selectedText: (text) => tuiTheme.selected(text),
      description: (text) => tuiTheme.muted(text),
      scrollInfo: (text) => tuiTheme.muted(text),
      noMatch: (text) => tuiTheme.warning(text),
    }
    const setMessage = (next: string) => { message = next; ui.requestRender() }
    const close = (notice = 'Transfer cancelled. Nothing changed.') => {
      if (!transferActive) return
      transferController?.abort()
      transferActive = false
      closeTransfer = null
      overlayPointer.clear()
      transferHoveredCommand = undefined
      overlay.unfocus?.({ target: screen })
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
      activeChoice = null
      const input = new (class extends piTui.Input {
        detailText = detail
        invalid = false
        override render(width: number): string[] {
          return renderSupervisorTransferInput(
            title,
            super.render(width),
            sanitize(this.detailText),
            this.invalid,
          )
        }
      })()
      input.setValue(initial)
      input.focused = true
      ui.setShowHardwareCursor(true)
      input.onEscape = () => { input.focused = false; ui.setShowHardwareCursor(false); back() }
      input.onSubmit = (value) => {
        const normalized = value.trim()
        const issue = validate(normalized)
        if (issue) { input.detailText = issue; input.invalid = true; input.invalidate(); ui.requestRender(); return }
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
      const maxVisible = Math.min(8, items.length)
      const list = new piTui.SelectList(items, maxVisible, theme)
      list.onSelect = (item) => select(item.value)
      list.onCancel = back
      activeChoice = { items, list, maxVisible }
      component = new (class implements Component {
        render(width: number): string[] {
          return renderSupervisorTransferChoice(title, list.render(width))
        }
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
      activeChoice = null
      setMessage('Building a checksum and exclusion plan…')
      component = {
        render: (width) => renderSupervisorTransferPlanning(width),
        invalidate: () => undefined,
      }
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
      render: (width) => renderSupervisorTransferReview(
        renderTransferPlanReview(state.plan!, width),
        state.plan!.readyToApply,
        width,
      ),
      handleInput: (data) => {
        if (piTui.matchesKey(data, 'escape') || piTui.matchesKey(data, 'n')) close()
        else if ((piTui.matchesKey(data, 'y') || piTui.matchesKey(data, 'enter')) && state.plan?.readyToApply) void applyTransfer()
      },
      invalidate: () => undefined,
    })
    const failureComponent = (): Component => ({
      render: (width) => renderSupervisorTransferRecovery(
        sanitize(state.error ?? 'Unknown error'),
        Boolean(state.plan?.readyToApply),
        width,
      ),
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
        render: (width) => renderSupervisorTransferProgress(progress, width),
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
      render: (width) => renderSupervisorTransferArrival(
        renderTransferResult(state.receipt!, machine.displayName, state.projectKey, width),
        width,
      ),
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
    const overlayOptions = {
      width: '92%',
      maxHeight: '92%',
      anchor: 'center',
      margin: 1,
    } as const
    const panel = new (class implements Component {
      render(width: number): string[] {
        const flightDeck = renderSupervisorTransferFlightDeck({
          phase: state.phase === 'failed' && state.plan ? 'transferring' : state.phase,
          sourceName: source.displayName,
          destinationName: selectedTransferDestination(state)?.displayName,
          content: component.render(Math.max(1, width >= 96 ? width - 43 : width - 4)),
          message: sanitize(message),
        }, width)
        const choice = activeChoice
        const choiceTarget = choice
          ? selectListPointerTarget(
              choice.items,
              choice.list,
              choice.maxVisible,
              flightDeck.contentFirstRow + 2,
            )
          : undefined
        captureOverlayPointer(
          flightDeck.lines,
          width,
          overlayOptions,
          (data) => this.handleInput(data),
          choiceTarget
            ? {
                ...choiceTarget,
                startColumn: flightDeck.contentStartColumn,
                endColumn: flightDeck.contentEndColumn,
              }
            : undefined,
          (label) => {
            if (transferHoveredCommand === label) return
            transferHoveredCommand = label
            ui.requestRender()
          },
        )
        return decorateSupervisorTransferFlightDeck(
          flightDeck.lines,
          tuiTheme,
          transferHoveredCommand,
        )
      }
      handleInput(data: string): void {
        transferHoveredCommand = undefined
        component.handleInput?.(data)
      }
      invalidate(): void { component.invalidate() }
    })()
    const overlay = ui.showOverlay(panel, overlayOptions)
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
      if (update.channel && update.channel !== screen.snapshot.channel) return
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
      stopMotionTimer()
      for (const controller of tunnelControllers.values()) controller.abort()
      tunnelControllers.clear()
      closeSourcePrompt?.()
      closeSettings?.()
      closeProjects?.()
      closeTransfer?.()
      closeUpdateChannel?.()
      closeConfirmation?.()
      closeCommandPalette?.()
      removeInputListener()
      process.off('SIGTERM', onTerminate)
      process.off('SIGINT', onTerminate)
      ui.stop()
      canvas.stop()
      resolve(code)
    }
    screen.setDetachHandler(() => finish())
    const onTerminate = () => finish()
    const removeInputListener = ui.addInputListener((data) => {
      const pointer = parseSupervisorPointer(data)
      if (pointer) {
        if (sourcePromptActive || settingsActive || projectsActive || transferActive || updateChannelActive || confirmationActive || commandPaletteActive) {
          overlayPointer.route(pointer)
        } else {
          screen.handlePointer(pointer)
        }
        return { consume: true }
      }
      if (confirmationActive) {
        if (piTui.matchesKey(data, 'ctrl+c')) {
          finish()
          return { consume: true }
        }
        if (piTui.matchesKey(data, 'escape')) screen.cancelConfirmation()
        else screen.handleKey(data, piTui.matchesKey)
        return { consume: true }
      }
      if (commandPaletteActive) {
        if (piTui.matchesKey(data, 'q') || piTui.matchesKey(data, 'ctrl+c')) {
          finish()
          return { consume: true }
        }
        if (piTui.matchesKey(data, 'escape')) screen.handleEscape()
        else screen.handleKey(data, piTui.matchesKey)
        return { consume: true }
      }
      if (sourcePromptActive || settingsActive || projectsActive || transferActive || updateChannelActive) {
        if (piTui.matchesKey(data, 'ctrl+c')) {
          finish()
          return { consume: true }
        }
        return undefined
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
    canvas.start()
    try {
      ui.start()
    } catch (error: unknown) {
      active = false
      clearInterval(poll)
      stopMotionTimer()
      removeInputListener()
      process.off('SIGTERM', onTerminate)
      process.off('SIGINT', onTerminate)
      canvas.stop()
      throw error
    }
    syncMotionTimer()
    void refreshFleet({ quiet: true })
    void discoverUpdateInBackground()
  })
}

export async function resolveSupervisorChannel(
  options: {
    moduleUrl?: string
    resolveLayout?: (moduleUrl?: string) => unknown
    readSource?: () => Promise<{
      updateChannel?: string
      selector?: { kind?: string; value?: string }
    }>
  } = {},
): Promise<SupervisorUpdateChannel> {
  const moduleUrl = options.moduleUrl ?? import.meta.url
  const layout = (
    options.resolveLayout ?? resolveInstalledLayout
  )(moduleUrl)
  if (!layout) return 'dev'
  const source = await (options.readSource ?? readInstallSource)()
  const explicit = normalizeSupervisorUpdateChannel(source.updateChannel)
  if (explicit) return explicit
  if (source.selector?.kind === 'branch' && source.selector.value === 'dev') return 'dev'
  if (source.selector?.kind === 'version' && source.selector.value?.includes('-beta')) return 'beta'
  return 'stable'
}

function normalizeSupervisorUpdateChannel(value: unknown): SupervisorUpdateChannel | null {
  return normalizeUpdateChannel(value) as SupervisorUpdateChannel | null
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
  private readonly onConfirmationChange?: (action?: SupervisorConfirmation) => void
  private readonly onCommandPaletteChange?: (open: boolean) => void
  private readonly requestRender?: () => void
  private readonly theme: SupervisorTuiTheme
  private readonly motionEnabled: boolean
  private readonly onMotionDemandChange?: () => void
  private onDetach?: () => void
  private hoveredPanel?: SupervisorPanel
  private headerReleaseHovered = false
  private headerReleaseTarget?: { startColumn: number; endColumn: number }
  private navigationTargets: SupervisorNavigationTarget[] = []
  private navigationBeaconColumn?: number
  private hoveredFleetTarget?: SupervisorFleetPointerTarget
  private hoveredCommandTarget?: SupervisorCommandTarget
  private commandTargets: SupervisorCommandTarget[] = []
  private commandDeckOpen = false
  private commandDeckState: SupervisorCommandDeckState = createSupervisorCommandDeckState()
  private commandDeckQuery = ''
  private motionFrame = 0
  private introFrame?: number
  private navigationTransition?: SupervisorNavigationTransition
  private runtimePulse = false
  private logsFromEnd = 0
  private logFilter: SupervisorLogFilter = 'all'
  private hoveredLogFromEnd: number | null = null
  private logTargets: SupervisorLogTarget[] = []
  private doctorState: SupervisorDoctorState = createSupervisorDoctorState()
  private doctorTargets: SupervisorDoctorTarget[] = []
  private helpState: SupervisorHelpState = createSupervisorHelpState()
  private helpTargets: SupervisorHelpTarget[] = []
  private homePrimaryHovered = false
  private homePrimaryTarget?: SupervisorHomeTarget
  private renderWidth = 80

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
      onConfirmationChange?: (action?: SupervisorConfirmation) => void
      onCommandPaletteChange?: (open: boolean) => void
      requestRender?: () => void
      theme?: SupervisorTuiTheme
      motionEnabled?: boolean
      onMotionDemandChange?: () => void
      onDetach?: () => void
    } = {},
  ) {
    this.snapshot = {
      panel: snapshot.fleet ? 'fleet' : 'overview',
      ...snapshot,
    }
    this.doctorState = createSupervisorDoctorState(this.snapshot.doctor)
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
    this.onConfirmationChange = callbacks.onConfirmationChange
    this.onCommandPaletteChange = callbacks.onCommandPaletteChange
    this.requestRender = callbacks.requestRender
    this.theme = callbacks.theme ?? createSupervisorTuiTheme({ NO_COLOR: '1' })
    this.motionEnabled = callbacks.motionEnabled ?? true
    this.onMotionDemandChange = callbacks.onMotionDemandChange
    this.introFrame = this.motionEnabled ? 0 : undefined
    this.onDetach = callbacks.onDetach
  }

  setDetachHandler(handler: () => void): void {
    this.onDetach = handler
  }

  update(patch: Partial<SupervisorSnapshot>): void {
    const wasBusy = Boolean(this.snapshot.busy)
    const previousConfirmation = this.snapshot.confirmation
    if (patch.logs !== undefined && patch.logs !== this.snapshot.logs) {
      this.logsFromEnd = 0
      this.hoveredLogFromEnd = null
    }
    if (patch.doctor !== undefined && patch.doctor !== this.snapshot.doctor) {
      this.doctorState = createSupervisorDoctorState(patch.doctor)
    }
    if (patch.busy !== undefined && patch.busy !== this.snapshot.busy) this.motionFrame = 0
    if (patch.runtime !== undefined) {
      const nextFleet = patch.fleet ?? this.snapshot.fleet
      const anyFleetRuntime = nextFleet?.machines.some((machine) => (
        machine.projects.some((project) => (
          project.runtime.class === 'running' || project.runtime.class === 'owned_elsewhere'
        ))
      )) ?? false
      this.runtimePulse = this.motionEnabled
        && (patch.runtime?.class === 'running'
          || patch.runtime?.class === 'owned_elsewhere'
          || anyFleetRuntime)
        ? !this.runtimePulse
        : false
    }
    this.snapshot = { ...this.snapshot, ...patch }
    if (this.snapshot.confirmation !== previousConfirmation) {
      this.onConfirmationChange?.(this.snapshot.confirmation)
    }
    const isBusy = Boolean(this.snapshot.busy)
    if (isBusy !== wasBusy) this.onMotionDemandChange?.()
    this.requestRender?.()
  }

  advanceMotion(): boolean {
    if (!this.motionEnabled) return false
    let changed = false
    if (this.introFrame !== undefined) {
      this.introFrame = this.introFrame >= 8 ? undefined : this.introFrame + 1
      changed = true
    }
    if (this.snapshot.busy) {
      this.motionFrame = (this.motionFrame + 1) % 10
      changed = true
    }
    if (this.navigationTransition) {
      this.navigationTransition = this.navigationTransition.frame >= 3
        ? undefined
        : {
            ...this.navigationTransition,
            frame: this.navigationTransition.frame + 1,
          }
      changed = true
    }
    return changed
  }

  hasActiveMotion(): boolean {
    return this.motionEnabled
      && (
        this.introFrame !== undefined
        || Boolean(this.snapshot.busy)
        || Boolean(this.navigationTransition)
      )
  }

  cancelConfirmation(): void {
    this.update({ confirmation: undefined, notice: 'Action cancelled.' })
  }

  renderCommandPalette(width: number) {
    const items = this.filteredCommandDeckItems()
    this.commandDeckState = normalizeSupervisorCommandDeckState(
      this.commandDeckState,
      items.length,
    )
    return renderSupervisorCommandDeck(
      items,
      this.commandDeckState,
      isConfigRecovery(this.snapshot)
        ? 'recovery'
        : this.snapshot.runtime?.class ?? 'unavailable',
      width,
      this.commandDeckQuery,
    )
  }

  commandPaletteItemCount(): number {
    return this.filteredCommandDeckItems().length
  }

  selectCommandPaletteItem(index: number): void {
    this.commandDeckState = normalizeSupervisorCommandDeckState({
      selected: index,
      hovered: index,
    }, this.commandPaletteItemCount())
    this.requestRender?.()
  }

  moveCommandPaletteSelection(delta: -1 | 1): void {
    this.commandDeckState = moveSupervisorCommandDeckSelection(
      this.commandDeckState,
      delta,
      this.commandPaletteItemCount(),
      false,
    )
    this.requestRender?.()
  }

  activateCommandPaletteItem(): boolean {
    return this.activateCommandDeckItem(
      this.filteredCommandDeckItems()[this.commandDeckState.selected],
    )
  }

  handleEscape(): boolean {
    if (this.commandDeckOpen) {
      this.setCommandPaletteOpen(false)
      return true
    }
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
        const confirmation = this.snapshot.confirmation
        this.update({ confirmation: undefined })
        if (confirmation === 'managed-source') {
          this.onPrepareManagedSource?.()
        } else if (confirmation === 'update') {
          this.onAction?.('apply-update')
        } else {
          this.onAction?.(confirmation)
        }
        return true
      }
      if (matchesKey(data, 'n')) {
        this.cancelConfirmation()
        return true
      }
      return false
    }
    if (data === '/' && !this.commandDeckOpen) {
      this.setCommandPaletteOpen(true)
      return true
    }
    if (this.commandDeckOpen) {
      if (data === '/') {
        this.setCommandPaletteOpen(false)
        return true
      }
      const items = this.filteredCommandDeckItems()
      if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
        this.commandDeckState = moveSupervisorCommandDeckSelection(
          this.commandDeckState,
          matchesKey(data, 'down') ? 1 : -1,
          items.length,
        )
        this.requestRender?.()
        return true
      }
      if (matchesKey(data, 'enter')) {
        return this.activateCommandDeckItem(items[this.commandDeckState.selected])
      }
      if (data === '\x7f' || data === '\b') {
        this.setCommandDeckQuery(this.commandDeckQuery.slice(0, -1))
        return true
      }
      if (data === '\x15') {
        this.setCommandDeckQuery('')
        return true
      }
      if (/^[\x20-\x7e]$/u.test(data) && this.commandDeckQuery.length < 48) {
        this.setCommandDeckQuery(`${this.commandDeckQuery}${data}`)
        return true
      }
      return true
    }
    if (matchesKey(data, '?')) {
      this.selectPanel(this.snapshot.panel === 'help' ? 'overview' : 'help')
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
    if (this.snapshot.panel === 'logs' || this.snapshot.panel === 'doctor') {
      if (this.snapshot.panel === 'logs' && matchesKey(data, 'f')) {
        this.logFilter = nextSupervisorLogFilter(this.logFilter)
        this.logsFromEnd = 0
        this.requestRender?.()
        return true
      }
      const direction = matchesKey(data, 'up') || matchesKey(data, 'pageUp')
        ? -1
        : matchesKey(data, 'down') || matchesKey(data, 'pageDown') ? 1 : 0
      if (direction !== 0) {
        const amount = matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown') ? 8 : 1
        if (this.snapshot.panel === 'doctor') {
          this.doctorState = moveSupervisorDoctorSelection(
            this.doctorState,
            direction * amount,
            this.snapshot.doctor,
            amount === 1,
          )
          this.requestRender?.()
        } else {
          this.scrollOperationalPanel(direction * amount)
        }
        return true
      }
      if (matchesKey(data, 'home') || matchesKey(data, 'end')) {
        if (this.snapshot.panel === 'doctor') {
          this.doctorState = selectSupervisorDoctorBoundary(
            this.snapshot.doctor,
            matchesKey(data, 'end'),
          )
          this.requestRender?.()
        } else {
          this.jumpOperationalPanel(matchesKey(data, 'end'))
        }
        return true
      }
    }
    if (this.snapshot.panel === 'help') {
      const recovery = isConfigRecovery(this.snapshot)
      const direction = matchesKey(data, 'up') || matchesKey(data, 'pageUp')
        ? -1
        : matchesKey(data, 'down') || matchesKey(data, 'pageDown') ? 1 : 0
      if (direction !== 0) {
        this.helpState = moveSupervisorHelpSelection(
          this.helpState,
          direction,
          recovery,
          !matchesKey(data, 'pageUp') && !matchesKey(data, 'pageDown'),
        )
        this.requestRender?.()
        return true
      }
      if (matchesKey(data, 'home') || matchesKey(data, 'end')) {
        this.helpState = selectSupervisorHelpBoundary(recovery, matchesKey(data, 'end'))
        this.requestRender?.()
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

  handlePointer(event: SupervisorPointerEvent): boolean {
    const headerRelease = !this.commandDeckOpen
      && event.row === 1
      && this.headerReleaseTarget
      && event.col >= this.headerReleaseTarget.startColumn
      && event.col <= this.headerReleaseTarget.endColumn
      ? this.headerReleaseTarget
      : undefined
    const hovered = !this.commandDeckOpen && event.row === 2
      ? supervisorNavigationPanelAt(this.navigationTargets, event.col)
      : undefined
    const fleet = !this.commandDeckOpen && this.snapshot.panel === 'fleet'
      ? this.snapshot.fleet
      : undefined
    const fleetTarget = fleet
      ? supervisorFleetTargetAt(fleet, this.renderWidth, event.col, event.row - 4)
      : undefined
    const doctorTarget = !this.commandDeckOpen && this.snapshot.panel === 'doctor'
      ? this.doctorTargets.find((target) => (
          target.row === event.row
          && event.col >= target.startColumn
          && event.col <= target.endColumn
        ))
      : undefined
    const logTarget = !this.commandDeckOpen && this.snapshot.panel === 'logs'
      ? this.logTargets.find((target) => (
          target.row === event.row
          && event.col >= target.startColumn
          && event.col <= target.endColumn
        ))
      : undefined
    const helpTarget = !this.commandDeckOpen && this.snapshot.panel === 'help'
      ? this.helpTargets.find((target) => (
          target.row === event.row
          && event.col >= target.startColumn
          && event.col <= target.endColumn
        ))
      : undefined
    const homePrimaryTarget = !this.commandDeckOpen && this.snapshot.panel === 'overview'
      && this.homePrimaryTarget
      && event.row === this.homePrimaryTarget.row
      && event.col >= this.homePrimaryTarget.startColumn
      && event.col <= this.homePrimaryTarget.endColumn
      ? this.homePrimaryTarget
      : undefined
    const commandTarget = commandAtPosition(this.commandTargets, event.col, event.row)
    if (event.motion) {
      const fleetHoverChanged = fleetTarget?.focus !== this.hoveredFleetTarget?.focus
        || fleetTarget?.index !== this.hoveredFleetTarget?.index
      const commandHoverChanged = commandTarget?.row !== this.hoveredCommandTarget?.row
        || commandTarget?.label !== this.hoveredCommandTarget?.label
      const doctorHover = doctorTarget?.index ?? null
      const doctorHoverChanged = doctorHover !== this.doctorState.hovered
      const logHover = logTarget?.fromEnd ?? null
      const logHoverChanged = logHover !== this.hoveredLogFromEnd
      const helpHover = helpTarget?.index ?? null
      const helpHoverChanged = helpHover !== this.helpState.hovered
      const homeHover = Boolean(homePrimaryTarget)
      const homeHoverChanged = homeHover !== this.homePrimaryHovered
      const headerReleaseHover = Boolean(headerRelease)
      const headerReleaseHoverChanged = headerReleaseHover !== this.headerReleaseHovered
      if (
        headerReleaseHoverChanged
        || hovered !== this.hoveredPanel
        || fleetHoverChanged
        || commandHoverChanged
        || doctorHoverChanged
        || logHoverChanged
        || helpHoverChanged
        || homeHoverChanged
      ) {
        this.headerReleaseHovered = headerReleaseHover
        this.hoveredPanel = hovered
        this.hoveredFleetTarget = fleetTarget
        this.hoveredCommandTarget = commandTarget
        this.doctorState = { ...this.doctorState, hovered: doctorHover }
        this.hoveredLogFromEnd = logHover
        this.helpState = { ...this.helpState, hovered: helpHover }
        this.homePrimaryHovered = homeHover
        this.requestRender?.()
      }
      return true
    }
    if (event.leftClick && headerRelease) {
      this.headerReleaseHovered = true
      return this.handleKey('u', (data, key) => data === key)
    }
    if (event.leftClick && hovered) {
      this.hoveredPanel = hovered
      this.selectPanel(hovered)
      return true
    }
    if (event.leftClick && logTarget) {
      this.logsFromEnd = logTarget.fromEnd
      this.hoveredLogFromEnd = logTarget.fromEnd
      this.requestRender?.()
      return true
    }
    if (event.leftClick && commandTarget) {
      return this.activatePointerCommand(commandTarget.label)
    }
    if (event.leftClick && homePrimaryTarget) {
      return this.handleKey('enter', (data, key) => data === key)
    }
    if (event.leftClick && helpTarget) {
      this.helpState = { selected: helpTarget.index, hovered: helpTarget.index }
      this.requestRender?.()
      return true
    }
    if (event.leftClick && doctorTarget) {
      this.doctorState = { selected: doctorTarget.index, hovered: doctorTarget.index }
      this.requestRender?.()
      return true
    }
    if (event.leftClick && fleet && fleetTarget) {
      const selected = fleetTarget.focus === 'machines'
        ? fleet.selectedMachine
        : fleet.selectedProjects[selectedFleetMachine(fleet)?.key ?? ''] ?? 0
      if (selected === fleetTarget.index) {
        if (fleetTarget.focus === 'machines') {
          this.update({ fleet: setFleetFocus(fleet, 'projects') })
        } else if (fleet.focus !== 'projects') {
          this.update({ fleet: setFleetFocus(fleet, 'projects') })
        } else {
          const machine = selectedFleetMachine(fleet)
          const project = selectedFleetProject(fleet)
          if (machine && project) this.onActivateFleet?.(machine, project)
        }
      } else {
        this.update({ fleet: selectFleetIndex(fleet, fleetTarget.focus, fleetTarget.index) })
      }
      return true
    }
    if (event.wheel !== null && fleet) {
      this.update({
        fleet: moveFleetSelection(fleet, event.wheel),
      })
      return true
    }
    if (event.wheel !== null && (this.snapshot.panel === 'logs' || this.snapshot.panel === 'doctor')) {
      this.scrollOperationalPanel(event.wheel)
      return true
    }
    if (event.wheel !== null && this.snapshot.panel === 'help') {
      this.helpState = moveSupervisorHelpSelection(
        this.helpState,
        event.wheel,
        isConfigRecovery(this.snapshot),
        false,
      )
      this.requestRender?.()
      return true
    }
    return event.release
  }

  render(width: number): string[] {
    this.renderWidth = width
    const runtime = this.snapshot.runtime
    const state = runtime?.class ?? 'unavailable'
    const updateBadge = this.snapshot.update?.status === 'available'
      ? ` · update ${formatUpdateCandidate(this.snapshot.update)}`
      : ''
    const navigation = renderSupervisorNavigation({
      selected: this.snapshot.panel ?? 'overview',
      recovery: isConfigRecovery(this.snapshot),
      machineCount: this.snapshot.fleet?.machines.length,
      logCount: this.snapshot.logs?.entries?.length,
      doctor: this.snapshot.doctor
        ? {
            failures: this.snapshot.doctor.summary?.failures ?? 0,
            warnings: this.snapshot.doctor.summary?.warnings ?? 0,
          }
        : undefined,
    }, Math.max(1, width - 4))
    this.navigationTargets = navigation.targets.map((target) => ({
      ...target,
      startColumn: target.startColumn + 2,
      endColumn: target.endColumn + 2,
    }))
    const navigationRail = renderNavigationBeaconRail(
      width,
      this.navigationTargets,
      this.snapshot.panel ?? 'overview',
      this.navigationTransition,
    )
    const navigationBeaconIndex = navigationRail.indexOf('┬')
    this.navigationBeaconColumn = navigationBeaconIndex >= 0
      ? navigationBeaconIndex + 1
      : undefined
    const header = renderSupervisorHeaderLayout(
      this.snapshot.version,
      this.snapshot.channel,
      width,
      updateBadge,
    )
    this.headerReleaseTarget = header.releaseTarget
    const lines = [
      header.line,
      `│ ${navigation.line} │`,
      navigationRail,
      '',
    ]

    this.doctorTargets = []
    this.logTargets = []
    this.helpTargets = []
    this.homePrimaryTarget = undefined
    if (this.snapshot.panel === 'fleet' && this.snapshot.fleet) {
      lines.push(...renderSupervisorFleet(
        this.snapshot.fleet,
        width,
        this.hoveredFleetTarget,
        this.runtimePulse,
      ))
    } else if (this.snapshot.panel === 'logs') {
      const logs = renderSupervisorLogs(
        this.snapshot.logs,
        width,
        this.logsFromEnd,
        this.logFilter,
        this.hoveredLogFromEnd,
      )
      const rowOffset = lines.length
      this.logTargets = logs.targets.map((target) => ({
        ...target,
        row: target.row + rowOffset,
      }))
      lines.push(...logs.lines)
    } else if (this.snapshot.panel === 'doctor') {
      this.doctorState = normalizeSupervisorDoctorState(
        this.doctorState,
        this.snapshot.doctor,
      )
      const doctor = renderSupervisorDoctor(this.snapshot.doctor, this.doctorState, width)
      const rowOffset = lines.length
      this.doctorTargets = doctor.targets.map((target) => ({
        ...target,
        row: target.row + rowOffset,
      }))
      lines.push(...doctor.lines)
    } else if (this.snapshot.panel === 'help') {
      const recovery = isConfigRecovery(this.snapshot)
      this.helpState = normalizeSupervisorHelpState(this.helpState, recovery)
      const help = renderSupervisorHelp(this.helpState, recovery, width)
      const rowOffset = lines.length
      this.helpTargets = help.targets.map((target) => ({
        ...target,
        row: target.row + rowOffset,
      }))
      lines.push(...help.lines)
    } else if (isConfigRecovery(this.snapshot)) {
      lines.push(...renderConfigRecovery(this.snapshot))
    } else {
      const reportedProvider = runtime?.provider?.kind
      const provider = reportedProvider && reportedProvider !== 'unknown'
        ? reportedProvider
        : this.snapshot.context?.runtimeProvider.kind ?? 'not resolved'
      const providerLabel = this.snapshot.context?.runtimeProvider.kind === 'bundle'
        ? `OpenAlice ${this.snapshot.version} · bundle ${this.snapshot.context.runtimeProvider.contentIdentity ?? 'verified'}`
        : provider
      const uptime = Number.isInteger(runtime?.uptimeSeconds)
        ? formatDuration(runtime?.uptimeSeconds ?? 0)
        : undefined
      const home = renderSupervisorHome({
        projectName: this.snapshot.context?.aliceProject.displayName ?? 'Default AliceProject',
        state,
        home: this.snapshot.context?.home ?? runtime?.home ?? 'default',
        web: runtime?.endpoints?.web ?? 'Not available until the Runtime starts',
        owner: formatOwner(runtime),
        provider: providerLabel,
        components: formatComponents(runtime),
        ...(uptime ? { uptime } : {}),
        guidance: renderGuidance(runtime, this.snapshot.context),
        primaryAction: primaryActionLabel(runtime),
        primaryHovered: this.homePrimaryHovered,
        pulse: this.runtimePulse,
      }, width)
      const rowOffset = lines.length
      this.homePrimaryTarget = {
        ...home.primaryTarget,
        row: home.primaryTarget.row + rowOffset,
      }
      lines.push(...home.lines)
    }

    const activity = renderSupervisorActivitySlot({
      ...(this.snapshot.busy ? { busy: sanitize(this.snapshot.busy) } : {}),
      ...(this.snapshot.notice ? { notice: sanitize(this.snapshot.notice) } : {}),
      ...(this.snapshot.diagnostic ? { diagnostic: sanitize(this.snapshot.diagnostic) } : {}),
    }, width, this.motionFrame, this.motionEnabled)
    lines.push(
      activity,
      ...(this.snapshot.panel === 'fleet' && this.snapshot.fleet
        ? fleetActionBar(
            this.snapshot.fleet,
            runtime,
            this.snapshot.context,
            width,
          )
        : this.snapshot.panel === 'logs'
          ? renderSupervisorCommandBar([
              { key: '↑↓', label: 'Scroll' },
              {
                key: 'f',
                label: `Show ${supervisorLogFilterLabel(nextSupervisorLogFilter(this.logFilter))}`,
              },
              { key: 'l', label: 'Reload' },
              { key: 'End', label: 'Latest' },
              { key: '?', label: 'More' },
            ], width)
          : this.snapshot.panel === 'doctor'
            ? renderSupervisorCommandBar([
                { key: '↑↓', label: 'Inspect' },
                { key: 'd', label: 'Rerun' },
                { key: 'Home', label: 'First' },
                { key: 'End', label: 'Last' },
              ], width)
            : this.snapshot.panel === 'help'
              ? renderSupervisorCommandBar([
                  { key: '↑↓', label: 'Explore', primary: true },
                  { key: '?', label: 'Close help' },
                  { key: 'q', label: 'Detach' },
                ], width)
          : actionBar(runtime, this.snapshot.context, width, isConfigRecovery(this.snapshot))),
      renderSupervisorDock({
        panel: this.snapshot.panel ?? 'overview',
        projectName: this.snapshot.context?.aliceProject.displayName,
        runtimeState: state,
        pulse: this.runtimePulse,
        commandPaletteOpen: this.commandDeckOpen,
        recovery: isConfigRecovery(this.snapshot),
      }, width),
    )
    const visibleLines = lines.map((line) => truncate(line, width))
    this.commandTargets = supervisorCommandTargets(visibleLines)
    return decorateSupervisorFrame(
      visibleLines,
      this.theme,
      {
        panel: this.snapshot.panel ?? 'overview',
        headerReleaseHovered: this.headerReleaseHovered,
        hoveredPanel: this.hoveredPanel,
        hoveredCommand: this.hoveredCommandTarget,
        runtimeClass: runtime?.class,
        introFrame: this.introFrame,
      },
    )
  }

  invalidate(): void {}

  private activatePointerCommand(label: string): boolean {
    if (label === 'q' || label === 'q / Esc') {
      this.onDetach?.()
      return true
    }
    if (label === '/') {
      this.setCommandPaletteOpen(!this.commandDeckOpen)
      return true
    }
    const input = pointerCommandInput(label)
    if (!input) return true
    if (input === 'escape') return this.handleEscape()
    return this.handleKey(input, (data, key) => data === key)
  }

  private commandDeckItems(): SupervisorCommandDeckItem[] {
    const runtime = this.snapshot.runtime
    return supervisorCommandDeckItems({
      recovery: isConfigRecovery(this.snapshot),
      runtimeState: runtime?.class ?? 'unavailable',
      primaryLabel: primaryActionLabel(runtime),
      primaryAvailable: Boolean(primaryAction(runtime) && this.actionAvailable(primaryAction(runtime)!)),
      startAvailable: this.actionAvailable('start'),
      restartAvailable: this.actionAvailable('restart'),
      stopAvailable: this.actionAvailable('stop'),
    })
  }

  private filteredCommandDeckItems(): SupervisorCommandDeckItem[] {
    return filterSupervisorCommandDeckItems(this.commandDeckItems(), this.commandDeckQuery)
  }

  private setCommandDeckQuery(query: string): void {
    if (this.commandDeckQuery === query) return
    this.commandDeckQuery = query
    this.commandDeckState = createSupervisorCommandDeckState()
    this.requestRender?.()
  }

  private activateCommandDeckItem(item?: SupervisorCommandDeckItem): boolean {
    if (!item) return true
    this.setCommandPaletteOpen(false)
    return this.handleKey(item.input, (data, key) => data === key)
  }

  private setCommandPaletteOpen(open: boolean): void {
    if (this.commandDeckOpen === open) return
    this.commandDeckOpen = open
    this.commandDeckQuery = ''
    this.commandDeckState = open
      ? createSupervisorCommandDeckState()
      : { ...this.commandDeckState, hovered: null }
    this.onCommandPaletteChange?.(open)
    this.requestRender?.()
  }

  private scrollOperationalPanel(direction: number): void {
    if (this.snapshot.panel === 'logs') {
      const length = supervisorFilteredLogCount(this.snapshot.logs, this.logFilter)
      this.logsFromEnd = clamp(this.logsFromEnd - direction, 0, Math.max(0, length - 1))
    } else if (this.snapshot.panel === 'doctor') {
      this.doctorState = moveSupervisorDoctorSelection(
        this.doctorState,
        direction,
        this.snapshot.doctor,
        false,
      )
    }
    this.requestRender?.()
  }

  private jumpOperationalPanel(end: boolean): void {
    if (this.snapshot.panel === 'logs') {
      this.logsFromEnd = end
        ? 0
        : Math.max(0, supervisorFilteredLogCount(this.snapshot.logs, this.logFilter) - 1)
    }
    this.requestRender?.()
  }

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
      : ['overview', 'fleet', 'logs', 'doctor', 'help']
    const current = panels.indexOf(this.snapshot.panel ?? 'overview')
    const panel = panels[(current + direction + panels.length) % panels.length]
      ?? 'overview'
    this.selectPanel(panel)
  }

  private selectPanel(panel: SupervisorPanel): void {
    this.setCommandPaletteOpen(false)
    this.homePrimaryHovered = false
    this.hoveredLogFromEnd = null
    const previous = this.snapshot.panel ?? 'overview'
    const previousTarget = this.navigationTargets.find((target) => target.panel === previous)
    this.navigationTransition = this.motionEnabled && previous !== panel
      ? {
          from: previous,
          fromColumn: this.navigationBeaconColumn ?? (previousTarget
            ? Math.round((previousTarget.startColumn + previousTarget.endColumn) / 2)
            : undefined),
          to: panel,
          frame: 0,
        }
      : undefined
    this.update({ panel })
    if (this.navigationTransition) this.onMotionDemandChange?.()
    if (panel === 'logs') this.onAction?.('logs')
    if (panel === 'doctor') this.onAction?.('doctor')
  }
}

function renderNavigationBeaconRail(
  width: number,
  targets: SupervisorNavigationTarget[],
  selected: SupervisorPanel,
  transition?: SupervisorNavigationTransition,
): string {
  const rail = `╰${'─'.repeat(Math.max(1, width - 2))}╯`
  const center = (panel: SupervisorPanel): number | undefined => {
    const target = targets.find((candidate) => candidate.panel === panel)
    return target
      ? Math.round((target.startColumn + target.endColumn) / 2)
      : undefined
  }
  const selectedCenter = center(selected)
  if (selectedCenter === undefined) return rail
  const fromCenter = transition?.fromColumn ?? (transition ? center(transition.from) : undefined)
  const toCenter = transition ? center(transition.to) : undefined
  const progress = transition
    ? [0, 0.2, 0.6, 1][Math.min(3, transition.frame)] ?? 1
    : 1
  const beaconColumn = fromCenter !== undefined && toCenter !== undefined
    ? Math.round(fromCenter + ((toCenter - fromCenter) * progress))
    : selectedCenter
  const index = Math.max(1, Math.min(rail.length - 2, beaconColumn - 1))
  return `${rail.slice(0, index)}┬${rail.slice(index + 1)}`
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
    checkUpdate: dependencies.checkUpdate
      ?? ((channel) => checkForUpdate({ channel }, shared)),
    discoverUpdate: dependencies.discoverUpdate ?? (() => maybeNotifyUpdate(
      { enabled: true },
      { ...shared, interactive: true, stderr: SILENT_OUTPUT },
    )),
    applyUpdate: dependencies.applyUpdate
      ?? ((result) => applyVerifiedSupervisorUpdate(result, { env })),
  }
}

function commandAtPosition(
  targets: SupervisorCommandTarget[],
  column: number,
  row: number,
): SupervisorCommandTarget | undefined {
  return targets.find((target) => (
    target.row === row
    && column >= target.startColumn
    && column <= target.endColumn
  ))
}

function pointerCommandInput(label: string): KeyId | undefined {
  const inputs: Record<string, KeyId> = {
    Enter: 'enter',
    'y / Enter': 'enter',
    'n / Esc': 'n',
    'Tab / →': 'tab',
    'Shift+Tab / ←': 'shift+tab',
    Tab: 'tab',
    'PgUp / PgDn': 'pageDown',
    '↑ / ↓': 'down',
    '↑↓': 'down',
    End: 'end',
    Home: 'home',
    '←': 'left',
    s: 's',
    o: 'o',
    r: 'r',
    x: 'x',
    l: 'l',
    f: 'f',
    d: 'd',
    u: 'u',
    i: 'i',
    p: 'p',
    m: 'm',
    c: 'c',
    '?': '?',
  }
  return inputs[label]
}

function fleetActionBar(
  fleet: SupervisorFleetState,
  runtime: RuntimeSummary | null,
  _context: ResolvedLaunchContext | undefined,
  width: number,
): string[] {
  const machine = selectedFleetMachine(fleet)
  const project = selectedFleetProject(fleet)
  if (machine?.key === 'local') {
    return renderSupervisorCommandBar(fleet.focus === 'machines'
      ? [
          { key: 'Enter', label: 'Browse projects', primary: true },
          { key: 'm', label: 'Transfer' },
          { key: '↑↓', label: 'Select' },
          { key: '?', label: 'More' },
        ]
      : [
          { key: 'Enter', label: runtime?.class === 'absent' ? 'Start & open' : 'Open', primary: true },
          { key: 'm', label: 'Transfer' },
          { key: '←', label: 'Machines' },
          { key: '?', label: 'More' },
        ], width)
  }
  if (fleet.focus === 'machines') {
    return renderSupervisorCommandBar([
      { key: 'Enter', label: 'Browse projects', primary: true },
      { key: '↑↓', label: 'Select' },
      { key: 'r', label: 'Refresh' },
      { key: '?', label: 'More' },
    ], width)
  }
  return renderSupervisorCommandBar([
    project?.runtime.class === 'absent'
      ? { key: 's', label: 'Start project', primary: true }
      : { key: 'Enter', label: 'Connect', primary: true },
    { key: '←', label: 'Machines' },
    { key: 'r', label: 'Refresh' },
    { key: '?', label: 'More' },
  ], width)
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function renderConfigRecovery(snapshot: SupervisorSnapshot): string[] {
  return [
    'AliceProject configuration cannot be read.',
    snapshot.recoveryReason === 'newer-schema'
      ? 'This file requires a newer OpenAlice than the running CLI.'
      : 'It may be corrupt, or it may require a newer OpenAlice.',
    'This Supervisor will not inspect, start, open, stop, restart, or configure a project.',
    'Press u to choose a channel and check for an OpenAlice update, or ? for help.',
  ]
}

function confirmationView(
  action: SupervisorConfirmation,
  runtime: RuntimeSummary | null,
  managedSource?: ManagedSourcePlan | null,
  update?: UpdateResult | null,
): SupervisorConfirmationView {
  if (action === 'update') {
    const target = formatUpdateCandidate(update)
    const sourceChannel = update?.sourceChannel ?? 'current'
    const targetChannel = update?.channel ?? 'selected'
    return {
      action,
      title: 'Confirm Update',
      meta: target,
      prompt: sourceChannel === targetChannel
        ? `Install OpenAlice ${target} from ${targetChannel} now?`
        : `Switch ${sourceChannel} → ${targetChannel} and install OpenAlice ${target}?`,
      impact: [
        `Current CLI: ${update?.currentVersion ?? 'this running process'}.`,
        'The release installer is downloaded, SHA-256 verified, then the installed command is atomically replaced.',
        'This Supervisor will not reload. After success, exit and run openalice again.',
      ],
      confirmLabel: 'Install update',
      cancelLabel: 'Not now',
    }
  }
  if (action === 'managed-source') {
    const selector = managedSource
      ? `${managedSource.selector.kind} ${managedSource.selector.value}`
      : 'the branch/version paired with this CLI'
    return {
      action,
      title: 'Confirm Managed Source',
      meta: managedSource?.state ?? 'prepare',
      prompt: `Prepare and use installer-managed OpenAlice source ${selector}?`,
      impact: [
        `Destination: ${managedSource?.appDir ?? 'the OpenAlice install root'}`,
        'First start may install dependencies and build the Runtime.',
      ],
      confirmLabel: 'Prepare source',
      cancelLabel: 'Not now',
    }
  }
  const stopping = action === 'stop'
  return {
    action,
    title: `Confirm ${stopping ? 'Stop' : 'Restart'}`,
    meta: formatOwner(runtime),
    prompt: `${stopping ? 'Stop' : 'Restart'} Runtime owned by ${formatOwner(runtime)}?`,
    impact: [stopping
      ? 'The Guardian-owned Runtime stops and active Web and agent sessions disconnect.'
      : 'The Guardian-owned Runtime stops and starts; active Web and agent sessions reconnect or end.'],
    confirmLabel: stopping ? 'Stop Runtime' : 'Restart Runtime',
    cancelLabel: 'Keep running',
  }
}

function actionBar(
  runtime: RuntimeSummary | null,
  _context: ResolvedLaunchContext | undefined,
  width: number,
  recovery = false,
): string[] {
  if (recovery) {
    return renderSupervisorCommandBar([
      { key: 'u', label: 'Update', primary: true },
      { key: '?', label: 'Help' },
    ], width)
  }
  if (runtime?.class === 'absent') {
    return renderSupervisorCommandBar([
      { key: 's', label: 'Start quietly' },
      { key: 'p', label: 'Setup' },
      { key: 'c', label: 'Source' },
      { key: '?', label: 'More' },
    ], width)
  }
  if (runtime?.endpoints?.web) {
    return renderSupervisorCommandBar(runtime.owner?.surface === 'cli-server'
      ? [
          { key: 'r', label: 'Restart' },
          { key: 'x', label: 'Stop' },
          { key: 'l', label: 'Logs' },
          { key: '?', label: 'More' },
        ]
      : [
          { key: 'd', label: 'Doctor' },
          { key: 'l', label: 'Logs' },
          { key: '?', label: 'More' },
        ], width)
  }
  return renderSupervisorCommandBar([
    { key: 'l', label: 'Logs' },
    { key: 'u', label: 'Update' },
    { key: '?', label: 'More' },
  ], width)
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
  return 'doctor'
}

function primaryActionLabel(runtime: RuntimeSummary | null): string {
  if (runtime?.class === 'absent') return 'Start OpenAlice & open Workspace'
  if (runtime?.endpoints?.web) return 'Open Workspace'
  return 'Run Runtime Doctor'
}

function formatUpdateNotice(
  update: UpdateResult,
  kind: 'check' | 'discover' = 'check',
): string {
  if (update.packageManager && update.status === 'available') {
    return update.channel === 'stable'
      ? `${update.packageManager.label ?? 'The package manager'} owns this installation. Update with: ${update.packageManager.update ?? 'the package manager'}`
      : `${update.packageManager.label ?? 'The package manager'} owns this installation and only follows stable. Use the direct installer explicitly to switch to ${update.channel}.`
  }
  if (update.status === 'available') {
    const version = formatUpdateCandidate(update)
    return kind === 'discover'
      ? `OpenAlice ${version} is available on ${update.channel}; press u to review and install it.`
      : `OpenAlice ${version} is available on ${update.channel}. Confirm below to install it now.`
  }
  if (update.status === 'current') {
    return `OpenAlice is current on ${update.channel ?? 'this channel'}.`
  }
  return update.message ?? 'Automatic update is unavailable for this install channel.'
}

function formatUpdateInstalledNotice(update: UpdateResult): string {
  const version = formatUpdateCandidate(update)
  return `Installed ${version}. This running Supervisor is still the previous CLI and did not reload. Press q to detach, then run openalice again.`
}

function formatUpdateCandidate(update?: UpdateResult | null): string {
  if (update?.channel === 'dev' && update.latestCommit) {
    return `dev@${update.latestCommit.slice(0, 12)}`
  }
  return update?.latestVersion ?? 'the available update'
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
  const updateChannel = normalizeSupervisorUpdateChannel(result.channel)
  if (
    result.status !== 'available'
    || result.packageManager !== undefined
    || !updateChannel
    || typeof result.latestVersion !== 'string'
    || typeof result.installer?.versionedUrl !== 'string'
    || typeof result.installer.sha256 !== 'string'
    || (updateChannel === 'dev' && (
      !/^[a-f0-9]{64}$/.test(result.latestArtifactSha256 ?? '')
      || !/^[a-f0-9]{16}$/.test(result.latestContentIdentity ?? '')
    ))
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
  return CLI_VERSION
}
