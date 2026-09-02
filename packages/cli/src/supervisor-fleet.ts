import type {
  MachineInventory,
  MachineProjectInventory,
} from './machine-inventory.ts'
import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import {
  supervisorScrollRailIndexAt,
  withSupervisorScrollRail,
} from './supervisor-scroll-rail.ts'
import { SUPERVISOR_BRAND_MARK_ROWS } from './supervisor-tui-theme.ts'

export { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'

export type FleetFocus = 'machines' | 'projects'

export const SUPERVISOR_FLEET_MIN_VISIBLE_ROWS = 5

export interface SupervisorFleetState {
  generatedAt: string
  machines: MachineInventory[]
  focus: FleetFocus
  selectedMachine: number
  selectedProjects: Record<string, number>
  refreshing: boolean
  tunnels: Record<string, 'connecting' | 'connected' | 'failed'>
}

export interface SupervisorFleetActiveTarget {
  machineKey: string
  projectKey: string
  transport: 'loopback' | 'ssh-forward'
}

export interface SupervisorFleetPointerTarget {
  focus: FleetFocus
  index: number
  surface?: 'pane'
}

export interface SupervisorFleetRailTarget {
  focus: FleetFocus
  index: number
  trackRow: number
}

export interface SupervisorFleetLaunchIntent {
  state: 'ready' | 'attention' | 'blocked' | 'select'
  headline: string
  summary: string
  action: {
    key: 'Enter' | 'r'
    label: string
  }
  handoff: [string, string, string]
}

export function createSupervisorFleetState(
  generatedAt: string,
  machines: MachineInventory[],
  currentProject?: string,
): SupervisorFleetState {
  const localIndex = Math.max(0, machines.findIndex((machine) => machine.key === 'local'))
  const local = machines[localIndex]
  const projectIndex = Math.max(
    0,
    local?.projects.findIndex((project) => project.key === currentProject) ?? 0,
  )
  return {
    generatedAt,
    machines,
    focus: machines.length > 1 ? 'machines' : 'projects',
    selectedMachine: localIndex,
    selectedProjects: local ? { [local.key]: projectIndex } : {},
    refreshing: false,
    tunnels: {},
  }
}

export function replaceFleetInventory(
  state: SupervisorFleetState,
  generatedAt: string,
  machines: MachineInventory[],
): SupervisorFleetState {
  const selectedKey = selectedFleetMachine(state)?.key
  const selectedMachine = Math.max(
    0,
    machines.findIndex((machine) => machine.key === selectedKey),
  )
  const selectedProjectKeys = Object.fromEntries(
    state.machines.map((machine) => [
      machine.key,
      machine.projects[state.selectedProjects[machine.key] ?? 0]?.key,
    ]),
  )
  const selectedProjects = { ...state.selectedProjects }
  for (const machine of machines) {
    const selectedKey = selectedProjectKeys[machine.key]
    const matched = machine.projects.findIndex((project) => project.key === selectedKey)
    selectedProjects[machine.key] = matched >= 0
      ? matched
      : clampIndex(selectedProjects[machine.key] ?? 0, machine.projects.length)
  }
  return {
    ...state,
    generatedAt,
    machines,
    selectedMachine,
    selectedProjects,
    refreshing: false,
  }
}

export function selectFleetProjectByKey(
  state: SupervisorFleetState,
  machineKey: string,
  projectKey: string,
): SupervisorFleetState {
  const machineIndex = state.machines.findIndex((machine) => machine.key === machineKey)
  if (machineIndex < 0) return state
  const projectIndex = state.machines[machineIndex]?.projects
    .findIndex((project) => project.key === projectKey) ?? -1
  if (projectIndex < 0) return state
  return {
    ...state,
    selectedMachine: machineIndex,
    selectedProjects: {
      ...state.selectedProjects,
      [machineKey]: projectIndex,
    },
  }
}

export function moveFleetSelection(
  state: SupervisorFleetState,
  direction: 1 | -1,
): SupervisorFleetState {
  if (state.focus === 'machines') {
    return {
      ...state,
      selectedMachine: wrapIndex(state.selectedMachine + direction, state.machines.length),
    }
  }
  const machine = selectedFleetMachine(state)
  if (!machine) return state
  return {
    ...state,
    selectedProjects: {
      ...state.selectedProjects,
      [machine.key]: wrapIndex(
        (state.selectedProjects[machine.key] ?? 0) + direction,
        machine.projects.length,
      ),
    },
  }
}

export function setFleetFocus(
  state: SupervisorFleetState,
  focus: FleetFocus,
): SupervisorFleetState {
  return { ...state, focus }
}

export function selectFleetIndex(
  state: SupervisorFleetState,
  focus: FleetFocus,
  index: number,
): SupervisorFleetState {
  if (focus === 'machines') {
    return {
      ...state,
      focus,
      selectedMachine: clampIndex(index, state.machines.length),
    }
  }
  const machine = selectedFleetMachine(state)
  if (!machine) return { ...state, focus }
  return {
    ...state,
    focus,
    selectedProjects: {
      ...state.selectedProjects,
      [machine.key]: clampIndex(index, machine.projects.length),
    },
  }
}

export function selectedFleetMachine(
  state: SupervisorFleetState | null | undefined,
): MachineInventory | undefined {
  return state?.machines[state.selectedMachine]
}

export function selectedFleetProject(
  state: SupervisorFleetState | null | undefined,
): MachineProjectInventory | undefined {
  const machine = selectedFleetMachine(state)
  return machine?.projects[state?.selectedProjects[machine.key] ?? 0]
}

export function supervisorFleetLaunchIntent(
  state: SupervisorFleetState,
): SupervisorFleetLaunchIntent {
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  if (!machine) {
    return launchIntent('blocked', 'NO MACHINE SELECTED', 'Refresh Machine inventory before continuing.', 'r', 'Refresh', [
      'Refresh inventory', 'Choose a Machine', 'Choose an AliceProject',
    ])
  }
  const machineReady = machine.connection === 'local' || machine.connection === 'online'
  if (state.focus === 'machines') {
    if (machine.projects.length === 0) {
      return launchIntent(
        machineReady ? 'attention' : 'blocked',
        machineReady ? 'NO ALICEPROJECTS FOUND' : `MACHINE ${machineStatus(machine).toUpperCase()}`,
        machine.issue?.message
          ?? `${machine.displayName} reports no registered AliceProjects right now.`,
        'r',
        'Refresh',
        ['Refresh inventory', 'Find AliceProjects', 'Choose a target'],
      )
    }
    return launchIntent(
      'select',
      machineReady ? 'CHOOSE AN ALICEPROJECT' : 'INSPECT LAST KNOWN TARGETS',
      machineReady
        ? `${machine.displayName} is available with ${machine.projects.length} AliceProject${machine.projects.length === 1 ? '' : 's'}.`
        : `${machine.displayName} is ${machineStatus(machine)}; its last known AliceProjects remain available to inspect.`,
      'Enter',
      'Browse projects',
      ['Browse projects', 'Choose a target', machineReady ? 'Start or connect' : 'Refresh before launch'],
    )
  }
  if (!machineReady) {
    return launchIntent(
      'blocked',
      `MACHINE ${machineStatus(machine).toUpperCase()}`,
      machine.issue?.message ?? `${machine.displayName} is not reachable right now.`,
      'r',
      'Refresh',
      ['Refresh inventory', 'Recover Machine', 'Start or connect'],
    )
  }
  if (!project) {
    return launchIntent('blocked', 'NO ALICEPROJECT SELECTED', 'Choose a registered AliceProject before continuing.', 'r', 'Refresh', [
      'Refresh inventory', 'Choose a project', 'Start or connect',
    ])
  }

  const runtimeReady = (project.runtime.class === 'running'
    || project.runtime.class === 'owned_elsewhere')
    && Boolean(project.runtime.webEndpoint)
  if (runtimeReady && machine.key === 'local') {
    return launchIntent(
      'ready',
      project.available ? 'READY TO USE' : 'READY TO USE · HOME MISSING',
      project.available
        ? 'Use the verified local Runtime without restarting it or opening a browser.'
        : 'Use the verified local Web route; the AliceProject home is currently missing.',
      'Enter',
      'Use AliceProject',
      ['Verify endpoint', 'Bind local target', 'Enter connected Home'],
    )
  }
  if (runtimeReady) {
    if (!machine.capabilities.openTunnel) {
      return launchIntent(
        'blocked',
        'SSH FORWARD UNAVAILABLE',
        `${machine.displayName} does not advertise the tunnel capability required by this TUI.`,
        'r',
        'Refresh',
        ['Refresh capability', 'Verify endpoint', 'Connect when ready'],
      )
    }
    return launchIntent(
      'ready',
      project.available ? 'READY TO CONNECT' : 'READY TO CONNECT · HOME MISSING',
      'Open a TUI-owned SSH forward without restarting the remote Runtime or opening a browser.',
      'Enter',
      'Connect',
      ['Validate endpoint', 'Open SSH forward', 'Enter connected Home'],
    )
  }
  if (!project.available) {
    return launchIntent(
      'blocked',
      'ALICEPROJECT UNAVAILABLE',
      `${project.displayName} is registered, but its project home is not available.`,
      'r',
      'Refresh',
      ['Refresh inventory', 'Recover project home', 'Start when ready'],
    )
  }
  if (project.runtime.class === 'absent') {
    if (machine.key !== 'local' && !machine.capabilities.lifecycle) {
      return launchIntent(
        'blocked',
        'REMOTE START UNAVAILABLE',
        `${machine.displayName} does not advertise the lifecycle capability required to start OpenAlice.`,
        'r',
        'Refresh',
        ['Refresh capability', 'Recover lifecycle', 'Start when ready'],
      )
    }
    return machine.key === 'local'
      ? launchIntent(
          'ready',
          'READY TO START',
          'Start OpenAlice locally, verify readiness, and stay inside this terminal.',
          'Enter',
          'Start OpenAlice',
          ['Start Runtime', 'Verify Web endpoint', 'Enter connected Home'],
        )
      : launchIntent(
          'ready',
          'READY TO START REMOTELY',
          'Start OpenAlice on the selected Machine, then continue through its SSH forward.',
          'Enter',
          'Start OpenAlice',
          ['Start remote Runtime', 'Refresh endpoint', 'Open SSH forward'],
        )
  }
  return launchIntent(
    'attention',
    'RUNTIME NEEDS ATTENTION',
    `${project.displayName} does not currently advertise a reachable Web endpoint.`,
    'r',
    'Refresh',
    ['Refresh inventory', 'Verify Runtime endpoint', 'Connect when ready'],
  )
}

export function fleetTunnelKey(machineKey: string, projectKey: string): string {
  return `${machineKey}/${projectKey}`
}

export function renderSupervisorFleet(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
  pulse = false,
  visibleRows = SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
  hoveredRail?: SupervisorFleetRailTarget,
  launcher = false,
  activeTarget?: SupervisorFleetActiveTarget,
): string[] {
  if (launcher && visibleRows <= 0) {
    return renderEmergencyLaunchCard(state, width)
  }
  const launchRail = launcher ? [...renderLaunchSequence(state, width), ''] : []
  if (launcher && supervisorFleetHasSingleLaunchTarget(state)) {
    return [
      ...launchRail,
      ...renderDirectLaunchBoard(state, width, pulse),
    ].map((line) => truncateDisplayWidth(line, width))
  }
  if (!launcher && activeTarget && supervisorFleetHasSingleLaunchTarget(state)) {
    return renderDirectConnectionBoard(state, width, pulse, activeTarget)
      .map((line) => truncateDisplayWidth(line, width))
  }
  const inventoryRows = launcher
    ? fleetLauncherInventoryRows(state, visibleRows)
    : fleetVisibleRows(state, visibleRows)
  if (fleetUsesNarrowLayout(width, launcher)) {
    return [...launchRail, ...renderNarrowFleet(
      state,
      width,
      hovered,
      pulse,
      launcher ? inventoryRows : SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
      hoveredRail,
      activeTarget,
      launcher,
    )]
  }
  const rowCount = inventoryRows
  const leftWidth = Math.max(28, Math.min(36, Math.floor(width * 0.38)))
  const gap = 3
  const rightWidth = Math.max(1, width - leftWidth - gap)
  const machine = selectedFleetMachine(state)
  const projectIndex = machine ? state.selectedProjects[machine.key] ?? 0 : 0
  const machineRows = renderMachineRows(
    state,
    leftWidth - 4,
    hovered,
    state.focus === 'machines',
    rowCount,
    hoveredRail?.focus === 'machines' ? hoveredRail.trackRow : null,
    activeTarget,
  )
  const projectRows = renderProjectRows(
    state,
    rightWidth - 4,
    hovered,
    pulse,
    state.focus === 'projects',
    rowCount,
    hoveredRail?.focus === 'projects' ? hoveredRail.trackRow : null,
    activeTarget,
  )
  const leftPane = renderPane(
    `Machines · ${positionLabel(state.selectedMachine, state.machines.length)}`,
    machineRows,
    leftWidth,
    state.focus === 'machines',
    hovered?.surface === 'pane' && hovered.focus === 'machines',
    rowCount,
  )
  const rightPane = renderPane(
    `AliceProjects · ${machine?.displayName ?? 'none'} · ${positionLabel(projectIndex, machine?.projects.length ?? 0)}`,
    projectRows,
    rightWidth,
    state.focus === 'projects',
    hovered?.surface === 'pane' && hovered.focus === 'projects',
    rowCount,
  )
  const lines: string[] = []
  for (let index = 0; index < rowCount + 2; index += 1) {
    lines.push(joinColumns(
      leftPane[index] ?? '',
      rightPane[index] ?? '',
      leftWidth,
      rightWidth,
      gap,
    ))
  }
  const availableDetailRows = fleetDetailRows(width, visibleRows, rowCount)
  const detailRows = launcher && availableDetailRows > 2
    ? 6
    : availableDetailRows
  lines.push('', ...renderDetailCard(state, width, pulse, detailRows, activeTarget, launcher))
  return [...launchRail, ...lines].map((line) => truncateDisplayWidth(line, width))
}

export function supervisorFleetHasSingleLaunchTarget(state: SupervisorFleetState): boolean {
  return state.machines.length === 1 && state.machines[0]?.projects.length === 1
}

function renderDirectConnectionBoard(
  state: SupervisorFleetState,
  width: number,
  pulse: boolean,
  activeTarget: SupervisorFleetActiveTarget,
): string[] {
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  if (!machine || !project) return renderPane('Connection Route', ['◇ Target unavailable'], width)
  const active = machine.key === activeTarget.machineKey && project.key === activeTarget.projectKey
  const remote = machine.key !== 'local'
  const mode = active ? 'LIVE' : 'SWITCH'
  const location = remote ? 'REMOTE' : 'LOCAL'
  const title = `${active ? 'Active Route' : 'Switch Route'} · ${mode} · ${location}`
  const primary = active
    ? 'Return Home'
    : remote ? 'Connect & Switch' : 'Switch AliceProject'
  const secondary = remote
    ? active ? '· [ x ] Disconnect SSH forward' : '· Current target stays live'
    : project.available ? '· [ m ] Transfer AliceProject' : '· Transfer unavailable'
  const identity = `${projectStatus(project, pulse)} ${project.displayName} · ${project.product === 'nano' ? 'NanoAlice' : 'TraderAlice'}`
  const route = `⌁ ${machine.displayName} → ${project.displayName}`
  const signal = compactConnectionSignals(project)
  const action = `◆ [ Enter ] ${primary}`

  if (width < 60) {
    return renderPane(title, [
      identity,
      `⌁ ${machine.displayName} · ${location}`,
      signal,
      action,
      secondary,
    ], width, undefined, false, 5)
  }
  if (width < 96) {
    return renderPane(title, [
      identity,
      route,
      active ? 'NOW  This is the active OpenAlice target.' : 'NOW  Current target stays live until this route is ready.',
      action,
      signal,
      secondary,
    ], width, undefined, false, 6)
  }

  const innerWidth = Math.max(1, width - 4)
  const gap = 4
  const leftWidth = Math.max(34, Math.floor((innerWidth - gap) * 0.48))
  const rightWidth = Math.max(1, innerWidth - leftWidth - gap)
  const left = [
    active ? 'ACTIVE ROUTE' : 'SWITCH CANDIDATE',
    identity,
    route,
    project.home,
    '',
    'NOW',
    active ? 'Connected and ready to use.' : 'Current target stays live until this route is ready.',
    action,
  ]
  const right = [
    'SIGNALS',
    signal,
    `↗ WEB  ${project.runtime.webEndpoint ?? 'not advertised'}`,
    `SERVICES  ${formatProjectComponents(project)}`,
    '',
    'DETAIL',
    `Product  ${project.product === 'nano' ? 'NanoAlice' : 'TraderAlice'} · Owner  ${project.runtime.ownerSurface ?? 'none'}`,
    secondary,
  ]
  const rows = left.map((line, index) => joinColumns(
    line,
    right[index] ?? '',
    leftWidth,
    rightWidth,
    gap,
  ))
  return renderPane(title, rows, width, undefined, false, rows.length)
}

function compactConnectionSignals(project: MachineProjectInventory): string {
  const runtimeReady = project.runtime.class === 'running' || project.runtime.class === 'owned_elsewhere'
  const webReady = Boolean(project.runtime.webEndpoint)
  const alice = project.runtime.components.alice?.toLowerCase() ?? ''
  const aliceReady = /\b(?:ready|running|connected|healthy|live)\b/u.test(alice)
  return [
    `${runtimeReady ? '●' : '○'} Runtime ${runtimeReady ? 'live' : project.runtime.class}`,
    `${webReady ? '●' : '○'} Web ${webReady ? 'ready' : 'off'}`,
    `${aliceReady ? '●' : '◇'} Alice ${aliceReady ? 'ready' : '?'}`,
  ].join(' · ')
}

function renderDirectLaunchBoard(
  state: SupervisorFleetState,
  width: number,
  pulse: boolean,
): string[] {
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  const intent = supervisorFleetLaunchIntent(state)
  const route = `${machine?.displayName ?? 'No Machine'} → ${project?.displayName ?? 'No AliceProject'}`
  const signal = intent.state === 'ready'
    ? '◆ READY TO LAUNCH'
    : intent.state === 'attention'
      ? '! NEEDS ATTENTION'
      : intent.state === 'blocked'
        ? '× LAUNCH BLOCKED'
        : '◇ CHOOSE A TARGET'
  const action = `◆ [ ${intent.action.key} ] ${intent.action.label}`

  if (width < 96) {
    return renderPane(
      `Launchpad · ${project?.displayName ?? 'AliceProject'}`,
      [
        `${signal} · ${route}`,
        intent.summary,
        `NEXT  ${compactLaunchConsequence(intent)}`,
        action,
      ],
      width,
      undefined,
      false,
      4,
    )
  }

  const innerWidth = width - 4
  const identityWidth = 28
  const gap = 4
  const taskWidth = Math.max(1, innerWidth - identityWidth - gap)
  const markWidth = displayWidth(SUPERVISOR_BRAND_MARK_ROWS[0])
  const markInset = ' '.repeat(Math.max(0, Math.floor((identityWidth - markWidth) / 2)))
  const handoff = directLaunchHandoffRows(intent, taskWidth)
  const identity = [
    labelAndTail('ALICEPROJECT', project ? projectStatus(project, pulse) : '◇ missing', identityWidth),
    '',
    ...SUPERVISOR_BRAND_MARK_ROWS.map((row) => `${markInset}${row}`),
    '',
    `⌂ ${project?.displayName ?? 'No AliceProject'}`,
    `⌁ ${machine?.displayName ?? 'No Machine'} · ${machine?.key === 'local' ? 'LOCAL' : 'SSH'}`,
    launchRuntimeStep(
      machine,
      project,
      Boolean(
        machine
        && (machine.connection === 'local' || machine.connection === 'online')
        && project?.available,
      ),
    ),
  ]
  const task = [
    `${signal} · ${intent.headline}`,
    route,
    intent.summary,
    '',
    'NEXT',
    ...handoff,
    '',
    '',
    action,
  ]
  const rowCount = Math.max(identity.length, task.length)
  const body = Array.from({ length: rowCount }, (_, index) => joinColumns(
    identity[index] ?? '',
    task[index] ?? '',
    identityWidth,
    taskWidth,
    gap,
  ))
  return renderPane(
    `Launchpad · ${project?.displayName ?? 'AliceProject'}`,
    body,
    width,
    undefined,
    false,
    rowCount,
  )
}

function directLaunchHandoffRows(
  intent: SupervisorFleetLaunchIntent,
  width: number,
): string[] {
  const steps = intent.handoff.map((stage, index) => `${index + 1} ${stage}`)
  const single = steps.join('  ━━━  ')
  if (displayWidth(single) <= width) return [single]
  return [
    `${steps[0]}  ━━━  ${steps[1]}`,
    steps[2] ?? '',
  ].map((row) => truncateDisplayWidth(row, width))
}

function renderEmergencyLaunchCard(
  state: SupervisorFleetState,
  width: number,
): string[] {
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  const machineReady = machine?.connection === 'local' || machine?.connection === 'online'
  const projectReady = Boolean(machineReady && project?.available)
  const intent = supervisorFleetLaunchIntent(state)
  return renderPane(
    `OPENALICE LAUNCH · ${state.focus === 'machines' ? 'MACHINE' : 'ALICEPROJECT'}`,
    [
      `1 MACHINE ${machineReady ? '✓' : '○'} ${machine?.displayName ?? 'Choose a Machine'}`,
      `2 ALICEPROJECT ${projectReady ? '✓' : '○'} ${project?.displayName ?? 'Choose an AliceProject'}`,
      `3 RUNTIME ${launchRuntimeStep(machine, project, projectReady)}`,
      `◆ [ ${intent.action.key} ] ${intent.action.label}`,
    ],
    width,
    undefined,
    false,
    4,
  )
}

export function supervisorFleetLauncherRows(width: number, launcher: boolean): number {
  if (!launcher) return 0
  return width >= 72 ? 4 : width >= 54 ? 5 : 6
}

function renderLaunchSequence(state: SupervisorFleetState, width: number): string[] {
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  const machineReady = machine?.connection === 'local' || machine?.connection === 'online'
  const projectReady = Boolean(machineReady && project?.available)
  const runtime = launchRuntimeStep(machine, project, projectReady)
  const machineStep = `1 MACHINE ${machineReady ? '✓' : '○'} ${machine?.displayName ?? 'Choose a Machine'}`
  const projectStep = `2 ALICEPROJECT ${projectReady ? '✓' : '○'} ${project?.displayName ?? 'Choose an AliceProject'}`
  const runtimeStep = `3 RUNTIME ${runtime}`
  const inner = Math.max(12, width - 4)
  const compactSteps = compactLaunchSteps(machine, project, machineReady, projectReady)
  const rows = width >= 72
    ? [joinLaunchSteps(width >= 96
      ? [machineStep, projectStep, runtimeStep]
      : compactSteps, inner)]
    : width >= 54
      ? [joinLaunchSteps(compactSteps.slice(0, 2), inner), compactSteps[2]!]
      : [machineStep, projectStep, runtimeStep]
  const title = supervisorFleetHasSingleLaunchTarget(state)
    ? 'OPENALICE LAUNCH · READY → START → CONNECT'
    : 'OPENALICE LAUNCH · SELECT → START → CONNECT'
  return renderPane(title, rows, width, undefined, false, rows.length)
}

function launchRuntimeStep(
  machine: MachineInventory | undefined,
  project: MachineProjectInventory | undefined,
  projectReady: boolean,
): string {
  if (!projectReady || !machine || !project) return '○ WAITING FOR SELECTION'
  if (project.runtime.class === 'absent') {
    return '○ READY TO START'
  }
  if ((project.runtime.class === 'running' || project.runtime.class === 'owned_elsewhere')
    && project.runtime.webEndpoint) {
    return machine.key === 'local' ? '● READY TO USE' : '● READY TO CONNECT'
  }
  return `◆ ${project.runtime.class.toUpperCase()} · OPEN RUNTIME TOOLS`
}

function compactLaunchSteps(
  machine: MachineInventory | undefined,
  project: MachineProjectInventory | undefined,
  machineReady: boolean,
  projectReady: boolean,
): string[] {
  const machineStep = `1 ${machineReady ? '✓' : '○'} ${machine?.displayName ?? 'Choose Machine'}`
  const projectStep = `2 ${projectReady ? '✓' : '○'} ${project?.displayName ?? 'Choose Project'}`
  let runtimeStep = '3 ○ SELECT TARGET'
  if (projectReady && machine && project) {
    if (project.runtime.class === 'absent') runtimeStep = '3 ○ READY TO START'
    else if ((project.runtime.class === 'running' || project.runtime.class === 'owned_elsewhere')
      && project.runtime.webEndpoint) {
      runtimeStep = machine.key === 'local' ? '3 ● READY TO USE' : '3 ● READY TO CONNECT'
    } else {
      runtimeStep = '3 ◆ CHECK RUNTIME'
    }
  }
  return [machineStep, projectStep, runtimeStep]
}

function joinLaunchSteps(steps: string[], width: number): string {
  const separator = '  ━━━  '
  const complete = steps.join(separator)
  if (displayWidth(complete) <= width) return complete
  const available = Math.max(1, width - displayWidth(separator) * (steps.length - 1))
  const each = Math.max(8, Math.floor(available / steps.length))
  return steps.map((step) => truncateDisplayWidth(step, each)).join(separator)
}

function renderNarrowFleet(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
  pulse = false,
  rowCount = SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
  hoveredRail?: SupervisorFleetRailTarget,
  activeTarget?: SupervisorFleetActiveTarget,
  launcher = false,
): string[] {
  const machine = selectedFleetMachine(state)
  if (state.focus === 'machines') {
    return [
      ...renderPane(
        `Machines · ${positionLabel(state.selectedMachine, state.machines.length)}`,
        renderMachineRows(
          state,
          width - 4,
          hovered,
          true,
          rowCount,
          hoveredRail?.focus === 'machines' ? hoveredRail.trackRow : null,
          activeTarget,
        ),
        width,
        true,
        hovered?.surface === 'pane',
        rowCount,
      ),
      ...(launcher ? [] : ['']),
      ...renderDetailCard(state, width, pulse, 2, activeTarget, launcher),
    ].map((line) => truncateDisplayWidth(line, width))
  }
  return [
    ...renderPane(
      `AliceProjects · ${machine?.displayName ?? 'none'} · ${positionLabel(state.selectedProjects[machine?.key ?? ''] ?? 0, machine?.projects.length ?? 0)}`,
      renderProjectRows(
        state,
        width - 4,
        hovered,
        pulse,
        true,
        rowCount,
        hoveredRail?.focus === 'projects' ? hoveredRail.trackRow : null,
        activeTarget,
      ),
      width,
      true,
      hovered?.surface === 'pane',
      rowCount,
    ),
    ...(launcher ? [] : ['']),
    ...renderDetailCard(state, width, pulse, 2, activeTarget, launcher),
  ].map((line) => truncateDisplayWidth(line, width))
}

export function supervisorFleetTargetAt(
  state: SupervisorFleetState,
  width: number,
  column: number,
  row: number,
  visibleRows = SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
  launcher = false,
  directConnection = false,
): SupervisorFleetPointerTarget | undefined {
  if (launcher && visibleRows <= 0) return undefined
  if (launcher && supervisorFleetHasSingleLaunchTarget(state)) return undefined
  if (directConnection) return undefined
  const narrow = fleetUsesNarrowLayout(width, launcher)
  const rowCount = launcher
    ? fleetLauncherInventoryRows(state, visibleRows)
    : narrow
      ? SUPERVISOR_FLEET_MIN_VISIBLE_ROWS
      : fleetVisibleRows(state, visibleRows)
  if (row < 1 || row > rowCount + 1) return undefined
  if (narrow) {
    const items = state.focus === 'machines'
      ? state.machines
      : selectedFleetMachine(state)?.projects ?? []
    const selected = state.focus === 'machines'
      ? state.selectedMachine
      : state.selectedProjects[selectedFleetMachine(state)?.key ?? ''] ?? 0
    if (row === 1) return { focus: state.focus, index: selected, surface: 'pane' }
    const offset = row - 2
    const index = visibleWindowStart(items.length, selected, rowCount) + offset
    return index < items.length
      ? { focus: state.focus, index }
      : { focus: state.focus, index: selected, surface: 'pane' }
  }
  const leftWidth = Math.max(28, Math.min(36, Math.floor(width * 0.38)))
  const gap = 3
  const focus = column <= leftWidth
    ? 'machines'
    : column <= leftWidth + gap
      ? undefined
      : 'projects'
  if (!focus) return undefined
  if (focus === 'machines') {
    if (row === 1) return { focus, index: state.selectedMachine, surface: 'pane' }
    const offset = row - 2
    const index = visibleWindowStart(
      state.machines.length,
      state.selectedMachine,
      rowCount,
    ) + offset
    return index < state.machines.length
      ? { focus, index }
      : { focus, index: state.selectedMachine, surface: 'pane' }
  }
  const machine = selectedFleetMachine(state)
  if (!machine) return undefined
  const selected = state.selectedProjects[machine.key] ?? 0
  if (row === 1) return { focus, index: selected, surface: 'pane' }
  const offset = row - 2
  const index = visibleWindowStart(machine.projects.length, selected, rowCount) + offset
  return index < machine.projects.length
    ? { focus, index }
    : { focus, index: selected, surface: 'pane' }
}

export function supervisorFleetRailTargetAt(
  state: SupervisorFleetState,
  width: number,
  column: number,
  row: number,
  visibleRows = SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
  launcher = false,
  directConnection = false,
): SupervisorFleetRailTarget | undefined {
  if (launcher && visibleRows <= 0) return undefined
  if (launcher && supervisorFleetHasSingleLaunchTarget(state)) return undefined
  if (directConnection) return undefined
  const narrow = fleetUsesNarrowLayout(width, launcher)
  const rowCount = launcher
    ? fleetLauncherInventoryRows(state, visibleRows)
    : narrow
      ? SUPERVISOR_FLEET_MIN_VISIBLE_ROWS
      : fleetVisibleRows(state, visibleRows)
  if (row < 2 || row > rowCount + 1) return undefined
  const trackRow = row - 2
  let focus: FleetFocus
  let items: readonly unknown[]
  if (narrow) {
    if (column !== width - 2) return undefined
    focus = state.focus
    items = focus === 'machines'
      ? state.machines
      : selectedFleetMachine(state)?.projects ?? []
  } else {
    const leftWidth = Math.max(28, Math.min(36, Math.floor(width * 0.38)))
    if (column === leftWidth - 2) {
      focus = 'machines'
      items = state.machines
    } else if (column === width - 2) {
      focus = 'projects'
      items = selectedFleetMachine(state)?.projects ?? []
    } else {
      return undefined
    }
  }
  const index = supervisorScrollRailIndexAt(trackRow, rowCount, items.length)
  return index === undefined ? undefined : { focus, index, trackRow }
}

function fleetUsesNarrowLayout(width: number, launcher: boolean): boolean {
  return width < 72 || (!launcher && width < 96)
}

function renderMachineRows(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
  focused = true,
  visibleRows = SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
  hoveredRailRow: number | null = null,
  activeTarget?: SupervisorFleetActiveTarget,
): string[] {
  if (state.machines.length === 0) return ['  No Machines registered']
  const start = visibleWindowStart(state.machines.length, state.selectedMachine, visibleRows)
  const rows = visibleWindow(state.machines, state.selectedMachine, visibleRows).map(({ item, index }) => {
    const selected = index === state.selectedMachine
    const prefix = selected
      ? focused ? '▶ ' : '◁ '
      : hovered?.surface !== 'pane' && hovered?.focus === 'machines' && hovered.index === index ? '» ' : '  '
    const status = machineStatus(item)
    const count = item.key === activeTarget?.machineKey
      ? `● ACTIVE · ${item.projects.length}`
      : item.connection === 'local' || item.connection === 'online'
      ? `${machineGlyph(item)} ${item.projects.length}`
      : `${machineGlyph(item)} ${status}`
    return labelAndTail(prefix + item.displayName, count, width)
  })
  return withSupervisorScrollRail(rows, width, {
    offset: start,
    total: state.machines.length,
    hoveredRow: hoveredRailRow,
  })
}

function renderProjectRows(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
  pulse = false,
  focused = true,
  visibleRows = SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
  hoveredRailRow: number | null = null,
  activeTarget?: SupervisorFleetActiveTarget,
): string[] {
  const machine = selectedFleetMachine(state)
  if (!machine) return ['  Select a Machine']
  if (machine.connection !== 'local' && machine.connection !== 'online') {
    return [`  ${machine.issue?.message ?? machineStatus(machine)}`]
  }
  if (machine.projects.length === 0) return ['  No registered AliceProjects']
  const selectedIndex = state.selectedProjects[machine.key] ?? 0
  const start = visibleWindowStart(machine.projects.length, selectedIndex, visibleRows)
  const rows = visibleWindow(machine.projects, selectedIndex, visibleRows).map(({ item, index }) => {
    const prefix = index === selectedIndex
      ? focused ? '▶ ' : '◁ '
      : hovered?.surface !== 'pane' && hovered?.focus === 'projects' && hovered.index === index ? '» ' : '  '
    const marks = [
      activeTarget?.machineKey === machine.key && activeTarget.projectKey === item.key ? 'ACTIVE' : '',
      item.isDefault ? 'default' : '',
      projectStatus(item, pulse),
    ].filter(Boolean).join(' · ')
    return labelAndTail(`${prefix}${item.displayName}`, marks, width)
  })
  return withSupervisorScrollRail(rows, width, {
    offset: start,
    total: machine.projects.length,
    hoveredRow: hoveredRailRow,
  })
}

function fleetSelectionDetail(
  state: SupervisorFleetState,
  pulse = false,
  width = 76,
  expanded = false,
  activeTarget?: SupervisorFleetActiveTarget,
): string[] {
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  if (!machine) return ['No Machine selected.']
  if (state.focus === 'machines' || !project) {
    const target = machine.sshTarget ? ` · ${machine.sshTarget}` : ''
    const identity = `${machine.key === activeTarget?.machineKey ? '● ACTIVE MACHINE · ' : ''}${machineGlyph(machine)} ${machine.displayName} · ${machineStatus(machine)}${target}`
    const facts = `${machine.platform ?? 'unknown'} / ${machine.arch ?? 'unknown'} · ${machine.projects.length} AliceProjects · checked ${formatChecked(state.generatedAt)}`
    const rows = expanded
      ? [identity, facts, '◆ [ Enter ] Browse projects']
      : [identity, '◆ [ Enter ] Browse projects']
    return expanded ? [...rows, ...expandedMachineDetail(machine, state, width)] : rows
  }
  const tunnel = state.tunnels[fleetTunnelKey(machine.key, project.key)]
  const active = activeTarget?.machineKey === machine.key && activeTarget.projectKey === project.key
  const switching = Boolean(activeTarget) && !active
  const identity = `${active ? '● ACTIVE TARGET · ' : switching ? '◇ SWITCH CANDIDATE · ' : ''}${projectStatus(project, pulse)} ${project.displayName} · ${project.product === 'nano' ? 'NanoAlice' : 'TraderAlice'} · ${project.runtime.ownerSurface ?? 'no owner'}`
  const path = [project.home, tunnel ? `tunnel ${tunnel}` : ''].filter(Boolean).join(' · ')
  const primary = active
    ? 'Return Home'
    : switching
      ? machine.key === 'local' ? 'Switch AliceProject' : 'Connect & Switch'
    : project.runtime.class === 'absent'
      ? 'Start OpenAlice'
      : machine.key === 'local'
        ? 'Use AliceProject'
        : 'Connect'
  const action = [
    `◆ [ Enter ] ${primary}`,
    ...(machine.key === 'local' && project.available ? ['[ m ] Transfer'] : []),
  ].join('  │  ')
  const rows = expanded ? [identity, path, action] : [identity, action]
  return expanded
    ? [...rows, ...expandedProjectDetail(machine, project, state, width, pulse)]
    : rows
}

function renderDetailCard(
  state: SupervisorFleetState,
  width: number,
  pulse = false,
  rowCount = 2,
  activeTarget?: SupervisorFleetActiveTarget,
  launcher = false,
): string[] {
  if (launcher) return renderLaunchBriefing(state, width, rowCount)
  const expanded = rowCount > 2
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  const activeSelection = state.focus === 'projects'
    && machine?.key === activeTarget?.machineKey
    && project?.key === activeTarget?.projectKey
  const switchSelection = state.focus === 'projects'
    && activeTarget != null
    && machine != null
    && project != null
    && !activeSelection
  const title = activeSelection
    ? expanded ? 'Active Connection · AliceProject' : 'Active Connection'
    : switchSelection
      ? expanded ? 'Switch Target · AliceProject' : 'Switch Target'
    : expanded
      ? `Selection Constellation · ${state.focus === 'machines' ? 'Machine' : 'AliceProject'}`
      : 'Selection'
  return renderPane(
    title,
    fleetSelectionDetail(state, pulse, width - 4, expanded, activeTarget),
    width,
    undefined,
    false,
    rowCount,
  )
}

function renderLaunchBriefing(
  state: SupervisorFleetState,
  width: number,
  rowCount: number,
): string[] {
  const intent = supervisorFleetLaunchIntent(state)
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  const route = state.focus === 'projects' && project
    ? `${machine?.displayName ?? 'No Machine'} → ${project.displayName}`
    : machine?.displayName ?? 'No Machine selected'
  const signal = intent.state === 'ready'
    ? '◆ LAUNCH READY'
    : intent.state === 'attention'
      ? '! LAUNCH ATTENTION'
      : intent.state === 'blocked'
        ? '× LAUNCH BLOCKED'
        : '◇ LAUNCH SELECT'
  const keycap = `[ ${intent.action.key} ]`
  const briefingStatus = intent.state === 'ready'
    ? `${signal} · ${route}`
    : `${signal} · ${intent.headline} · ${route}`
  if (rowCount <= 2) {
    return renderPane(
      `Launch Briefing · ${state.focus === 'machines' ? 'Machine' : 'AliceProject'}`,
      [
        briefingStatus,
        `◆ ${keycap} ${intent.action.label} · ${compactLaunchConsequence(intent)}`,
      ],
      width,
      undefined,
      false,
      rowCount,
    )
  }

  return renderPane(
    `Launch Briefing · ${state.focus === 'machines' ? 'Machine' : 'AliceProject'}`,
    [
      briefingStatus,
      intent.summary,
      '',
      `NEXT  ${joinLaunchSteps(
        intent.handoff.map((stage, index) => `${index + 1} ${stage}`),
        Math.max(1, width - 10),
      )}`,
      '',
      `◆ ${keycap} ${intent.action.label}`,
    ],
    width,
    undefined,
    false,
    rowCount,
  )
}

function fleetLauncherInventoryRows(
  state: SupervisorFleetState,
  visibleRows: number,
): number {
  const machine = selectedFleetMachine(state)
  const candidates = Math.max(state.machines.length, machine?.projects.length ?? 0)
  return Math.max(1, Math.min(Math.max(1, Math.floor(visibleRows)), candidates))
}

function compactLaunchConsequence(intent: SupervisorFleetLaunchIntent): string {
  if (intent.action.key === 'r') return 'recheck target availability'
  if (intent.action.label === 'Browse projects') return 'choose an AliceProject next'
  if (intent.action.label === 'Start OpenAlice') return 'stay here through readiness'
  if (intent.action.label === 'Connect') return 'open its SSH forward into Home'
  if (intent.action.label === 'Use AliceProject') return 'enter connected Home'
  return intent.summary
}

function expandedProjectDetail(
  machine: MachineInventory,
  project: MachineProjectInventory,
  state: SupervisorFleetState,
  width: number,
  pulse: boolean,
): string[] {
  const runtimeActive = project.runtime.class === 'running'
    || project.runtime.class === 'owned_elsewhere'
  const web = project.runtime.webEndpoint
    ? `↗ WEB  ${project.runtime.webEndpoint}`
    : '◇ WEB  Not advertised by Runtime'
  return [
    '',
    '◇ CONTROL ROUTE',
    fleetRoute(
      `${machineGlyph(machine)} ${machine.displayName}`,
      `${projectStatus(project, pulse)} ${project.displayName}`,
      width,
      runtimeActive,
      pulse,
    ),
    `  ╰━━${fleetSignalTrack(7, runtimeActive, !pulse)} ${truncateDisplayWidth(web, Math.max(1, width - 8))}`,
    '',
    labelAndTail(
      `PRODUCT  ${project.product === 'nano' ? 'NanoAlice' : 'TraderAlice'}`,
      `PORT  ${project.port}${project.portAutomatic ? ' · AUTO' : ' · FIXED'}`,
      width,
    ),
    labelAndTail(
      `OWNER    ${project.runtime.ownerSurface ?? 'none'}`,
      `UPTIME  ${formatFleetDuration(project.runtime.uptimeSeconds)}`,
      width,
    ),
    labelAndTail(
      `SERVICES ${formatProjectComponents(project)}`,
      project.isDefault ? 'DEFAULT  YES' : 'DEFAULT  NO',
      width,
    ),
    labelAndTail(
      `CAPS     ${formatMachineCapabilities(machine)}`,
      `CHECKED  ${formatChecked(state.generatedAt)}`,
      width,
    ),
  ]
}

function expandedMachineDetail(
  machine: MachineInventory,
  state: SupervisorFleetState,
  width: number,
): string[] {
  const target = machine.connection === 'local'
    ? 'local control plane'
    : machine.sshTarget ?? 'SSH target unavailable'
  return [
    '',
    '◇ MACHINE ROUTE',
    fleetRoute(
      `${machineGlyph(machine)} ${machine.displayName}`,
      `${machine.projects.length} ALICEPROJECT${machine.projects.length === 1 ? '' : 'S'}`,
      width,
      machine.connection === 'local' || machine.connection === 'online',
      false,
    ),
    `  TARGET   ${truncateDisplayWidth(target, Math.max(1, width - 11))}`,
    '',
    labelAndTail(
      `HOST     ${machine.hostname ?? 'unknown'}`,
      `CLI  ${machine.cliVersion ?? 'unknown'}`,
      width,
    ),
    labelAndTail(
      `PLATFORM ${machine.platform ?? 'unknown'} / ${machine.arch ?? 'unknown'}`,
      `DEFAULT  ${machine.defaultProject ?? 'none'}`,
      width,
    ),
    labelAndTail(
      `CAPS     ${formatMachineCapabilities(machine)}`,
      `CHECKED  ${formatChecked(state.generatedAt)}`,
      width,
    ),
  ]
}

function fleetRoute(
  from: string,
  to: string,
  width: number,
  active: boolean,
  pulse: boolean,
): string {
  const safeFrom = truncateDisplayWidth(from, Math.max(1, Math.floor(width * 0.3)))
  const safeTo = truncateDisplayWidth(to, Math.max(1, Math.floor(width * 0.4)))
  const trackWidth = Math.max(5, width - displayWidth(safeFrom) - displayWidth(safeTo) - 2)
  return truncateDisplayWidth(
    `${safeFrom} ${fleetSignalTrack(trackWidth, active, pulse)} ${safeTo}`,
    width,
  )
}

function fleetSignalTrack(width: number, active: boolean, pulse: boolean): string {
  const track = Array.from({ length: Math.max(3, width) }, () => '━')
  const packet = Math.floor(track.length * (pulse ? 0.7 : 0.3))
  track[Math.min(track.length - 2, Math.max(1, packet))] = active ? '◆' : '·'
  return track.join('')
}

function formatProjectComponents(project: MachineProjectInventory): string {
  const components = Object.entries(project.runtime.components)
  if (components.length === 0) return 'not reported'
  return components.map(([name, status]) => (
    `${name.charAt(0).toUpperCase()}${name.slice(1)} ${status}`
  )).join(' · ')
}

function formatMachineCapabilities(machine: MachineInventory): string {
  const labels: Array<[keyof MachineInventory['capabilities'], string]> = [
    ['inspect', 'inspect'],
    ['lifecycle', 'lifecycle'],
    ['openTunnel', 'tunnel'],
    ['transferReceive', 'receive'],
    ['credentialReseal', 'reseal'],
  ]
  const enabled = labels.filter(([key]) => machine.capabilities[key]).map(([, label]) => label)
  return enabled.length > 0 ? enabled.join(' · ') : 'none reported'
}

function formatFleetDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'not reported'
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3_600)}h ${Math.floor((seconds % 3_600) / 60)}m`
}

function launchIntent(
  state: SupervisorFleetLaunchIntent['state'],
  headline: string,
  summary: string,
  key: SupervisorFleetLaunchIntent['action']['key'],
  label: string,
  handoff: SupervisorFleetLaunchIntent['handoff'],
): SupervisorFleetLaunchIntent {
  return { state, headline, summary, action: { key, label }, handoff }
}

function fleetDetailRows(width: number, requestedRows: number, inventoryRows: number): number {
  if (width < 100 || !Number.isFinite(requestedRows)) return 2
  const available = 2 + Math.max(0, Math.floor(requestedRows) - inventoryRows)
  return available >= 9 ? Math.min(12, available) : 2
}

function renderPane(
  title: string,
  rows: string[],
  width: number,
  focused?: boolean,
  hovered = false,
  rowCount = SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
): string[] {
  const safeWidth = Math.max(12, width)
  const innerWidth = safeWidth - 4
  const titlePrefix = focused === true ? '◆ ' : hovered ? '» ' : focused === false ? '◇ ' : ''
  const titleText = ` ${titlePrefix}${title} `
  const topFill = Math.max(0, safeWidth - displayWidth(titleText) - 2)
  const body = Array.from({ length: rowCount }, (_, index) => rows[index] ?? '')
  return [
    `╭${truncateDisplayWidth(titleText, safeWidth - 2)}${'─'.repeat(topFill)}╮`,
    ...body.map((row) => {
      const text = truncateDisplayWidth(row, innerWidth)
      return `│ ${text}${' '.repeat(Math.max(0, innerWidth - displayWidth(text)))} │`
    }),
    `╰${'─'.repeat(Math.max(0, safeWidth - 2))}╯`,
  ]
}

function machineStatus(machine: MachineInventory): string {
  if (machine.issue?.code === 'ECHECKING') return 'checking'
  if (machine.connection === 'local') return 'local'
  return machine.connection
}

function machineGlyph(machine: MachineInventory): string {
  if (machine.issue?.code === 'ECHECKING') return '◌'
  if (machine.connection === 'local' || machine.connection === 'online') return '●'
  if (machine.connection === 'offline') return '○'
  return '◆'
}

function projectStatus(project: MachineProjectInventory, pulse = false): string {
  if (!project.available && project.runtime.class === 'running') {
    return '◆ running · home missing'
  }
  if (!project.available && project.runtime.class === 'owned_elsewhere') {
    return '◆ external · home missing'
  }
  if (!project.available) return '◇ missing'
  const runningGlyph = pulse ? '◉' : '●'
  if (project.runtime.class === 'running') return `${runningGlyph} running`
  if (project.runtime.class === 'owned_elsewhere') return `${runningGlyph} external`
  if (project.runtime.class === 'absent') return '○ stopped'
  if (project.runtime.class === 'incompatible') return '◆ incompatible'
  if (project.runtime.class === 'unhealthy') return '◆ unhealthy'
  return `◌ ${project.runtime.class}`
}

function positionLabel(index: number, length: number): string {
  return length > 0 ? `${clampIndex(index, length) + 1}/${length}` : '0/0'
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(width / 2)))
  const tailWidth = displayWidth(safeTail)
  const labelWidth = Math.max(1, width - tailWidth - 1)
  const safeLabel = truncateDisplayWidth(label, labelWidth)
  return `${safeLabel}${' '.repeat(Math.max(1, width - displayWidth(safeLabel) - tailWidth))}${safeTail}`
}

function joinColumns(
  left: string,
  right: string,
  leftWidth: number,
  rightWidth: number,
  gap: number,
): string {
  const leftText = truncateDisplayWidth(left, leftWidth)
  const rightText = truncateDisplayWidth(right, rightWidth)
  return `${leftText}${' '.repeat(Math.max(0, leftWidth - displayWidth(leftText) + gap))}${rightText}`
}

function visibleWindow<T>(items: T[], selected: number, limit: number): Array<{ item: T; index: number }> {
  const start = visibleWindowStart(items.length, selected, limit)
  return items.slice(start, start + limit).map((item, offset) => ({ item, index: start + offset }))
}

function visibleWindowStart(length: number, selected: number, limit: number): number {
  if (length <= limit) return 0
  return Math.min(Math.max(0, selected - Math.floor(limit / 2)), length - limit)
}

function fleetVisibleRows(state: SupervisorFleetState, requested: number): number {
  const inventoryRows = Math.max(
    SUPERVISOR_FLEET_MIN_VISIBLE_ROWS,
    state.machines.length,
    selectedFleetMachine(state)?.projects.length ?? 0,
  )
  const safeRequested = Number.isFinite(requested)
    ? Math.max(SUPERVISOR_FLEET_MIN_VISIBLE_ROWS, Math.floor(requested))
    : SUPERVISOR_FLEET_MIN_VISIBLE_ROWS
  return Math.min(safeRequested, inventoryRows)
}

function formatChecked(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toISOString().slice(11, 19) + 'Z'
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return (index + length) % length
}

function clampIndex(index: number, length: number): number {
  return length <= 0 ? 0 : Math.min(Math.max(0, index), length - 1)
}
