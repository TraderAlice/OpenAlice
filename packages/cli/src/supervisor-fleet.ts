import type {
  MachineInventory,
  MachineProjectInventory,
} from './machine-inventory.ts'

export type FleetFocus = 'machines' | 'projects'

export interface SupervisorFleetState {
  generatedAt: string
  machines: MachineInventory[]
  focus: FleetFocus
  selectedMachine: number
  selectedProjects: Record<string, number>
  refreshing: boolean
  tunnels: Record<string, 'connecting' | 'connected' | 'failed'>
}

export interface SupervisorFleetPointerTarget {
  focus: FleetFocus
  index: number
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

export function fleetTunnelKey(machineKey: string, projectKey: string): string {
  return `${machineKey}/${projectKey}`
}

export function renderSupervisorFleet(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
  pulse = false,
): string[] {
  if (width < 72) return renderNarrowFleet(state, width, hovered, pulse)
  const leftWidth = Math.max(28, Math.min(36, Math.floor(width * 0.38)))
  const gap = 3
  const rightWidth = Math.max(1, width - leftWidth - gap)
  const machine = selectedFleetMachine(state)
  const projectIndex = machine ? state.selectedProjects[machine.key] ?? 0 : 0
  const machineRows = renderMachineRows(state, leftWidth - 4, hovered)
  const projectRows = renderProjectRows(state, rightWidth - 4, hovered, pulse)
  const leftPane = renderPane(
    `Machines · ${positionLabel(state.selectedMachine, state.machines.length)}`,
    machineRows,
    leftWidth,
    state.focus === 'machines',
  )
  const rightPane = renderPane(
    `AliceProjects · ${machine?.displayName ?? 'none'} · ${positionLabel(projectIndex, machine?.projects.length ?? 0)}`,
    projectRows,
    rightWidth,
    state.focus === 'projects',
  )
  const lines: string[] = []
  for (let index = 0; index < FLEET_VISIBLE_ROWS + 2; index += 1) {
    lines.push(joinColumns(
      leftPane[index] ?? '',
      rightPane[index] ?? '',
      leftWidth,
      rightWidth,
      gap,
    ))
  }
  lines.push('', ...renderDetailCard(state, width, pulse))
  return lines.map((line) => truncateDisplayWidth(line, width))
}

function renderNarrowFleet(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
  pulse = false,
): string[] {
  const machine = selectedFleetMachine(state)
  if (state.focus === 'machines') {
    return [
      ...renderPane(
        `Machines · ${positionLabel(state.selectedMachine, state.machines.length)}`,
        renderMachineRows(state, width - 4, hovered),
        width,
        true,
      ),
      '',
      ...renderDetailCard(state, width, pulse),
    ].map((line) => truncateDisplayWidth(line, width))
  }
  return [
    ...renderPane(
      `AliceProjects · ${machine?.displayName ?? 'none'} · ${positionLabel(state.selectedProjects[machine?.key ?? ''] ?? 0, machine?.projects.length ?? 0)}`,
      renderProjectRows(state, width - 4, hovered, pulse),
      width,
      true,
    ),
    '',
    ...renderDetailCard(state, width, pulse),
  ].map((line) => truncateDisplayWidth(line, width))
}

export function supervisorFleetTargetAt(
  state: SupervisorFleetState,
  width: number,
  column: number,
  row: number,
): SupervisorFleetPointerTarget | undefined {
  if (row < 2 || row > FLEET_VISIBLE_ROWS + 1) return undefined
  const offset = row - 2
  if (width < 72) {
    const items = state.focus === 'machines'
      ? state.machines
      : selectedFleetMachine(state)?.projects ?? []
    const selected = state.focus === 'machines'
      ? state.selectedMachine
      : state.selectedProjects[selectedFleetMachine(state)?.key ?? ''] ?? 0
    const index = visibleWindowStart(items.length, selected, FLEET_VISIBLE_ROWS) + offset
    return index < items.length ? { focus: state.focus, index } : undefined
  }
  const leftWidth = Math.max(28, Math.min(36, Math.floor(width * 0.38)))
  const gap = 3
  if (column <= leftWidth) {
    const index = visibleWindowStart(
      state.machines.length,
      state.selectedMachine,
      FLEET_VISIBLE_ROWS,
    ) + offset
    return index < state.machines.length ? { focus: 'machines', index } : undefined
  }
  if (column <= leftWidth + gap) return undefined
  const machine = selectedFleetMachine(state)
  if (!machine) return undefined
  const selected = state.selectedProjects[machine.key] ?? 0
  const index = visibleWindowStart(machine.projects.length, selected, FLEET_VISIBLE_ROWS) + offset
  return index < machine.projects.length ? { focus: 'projects', index } : undefined
}

function renderMachineRows(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
): string[] {
  if (state.machines.length === 0) return ['  No Machines registered']
  return visibleWindow(state.machines, state.selectedMachine, FLEET_VISIBLE_ROWS).map(({ item, index }) => {
    const selected = index === state.selectedMachine
    const prefix = selected ? '› ' : hovered?.focus === 'machines' && hovered.index === index ? '» ' : '  '
    const status = machineStatus(item)
    const count = item.connection === 'local' || item.connection === 'online'
      ? `${machineGlyph(item)} ${item.projects.length}`
      : `${machineGlyph(item)} ${status}`
    return labelAndTail(prefix + item.displayName, count, width)
  })
}

function renderProjectRows(
  state: SupervisorFleetState,
  width: number,
  hovered?: SupervisorFleetPointerTarget,
  pulse = false,
): string[] {
  const machine = selectedFleetMachine(state)
  if (!machine) return ['  Select a Machine']
  if (machine.connection !== 'local' && machine.connection !== 'online') {
    return [`  ${machine.issue?.message ?? machineStatus(machine)}`]
  }
  if (machine.projects.length === 0) return ['  No registered AliceProjects']
  const selectedIndex = state.selectedProjects[machine.key] ?? 0
  return visibleWindow(machine.projects, selectedIndex, FLEET_VISIBLE_ROWS).map(({ item, index }) => {
    const prefix = index === selectedIndex
      ? '› '
      : hovered?.focus === 'projects' && hovered.index === index ? '» ' : '  '
    const marks = [
      item.isDefault ? 'default' : '',
      projectStatus(item, pulse),
    ].filter(Boolean).join(' · ')
    return labelAndTail(`${prefix}${item.displayName}`, marks, width)
  })
}

function fleetSelectionDetail(state: SupervisorFleetState, pulse = false): string[] {
  const machine = selectedFleetMachine(state)
  const project = selectedFleetProject(state)
  if (!machine) return ['No Machine selected.']
  if (state.focus === 'machines' || !project) {
    const target = machine.sshTarget ? ` · ${machine.sshTarget}` : ''
    return [
      `${machineGlyph(machine)} ${machine.displayName} · ${machineStatus(machine)}${target}`,
      `${machine.platform ?? 'unknown'} / ${machine.arch ?? 'unknown'} · ${machine.projects.length} AliceProjects · checked ${formatChecked(state.generatedAt)}`,
    ]
  }
  const tunnel = state.tunnels[fleetTunnelKey(machine.key, project.key)]
  return [
    `${projectStatus(project, pulse)} ${project.displayName} · ${project.product === 'nano' ? 'NanoAlice' : 'TraderAlice'} · ${project.runtime.ownerSurface ?? 'no owner'}`,
    [project.home, tunnel ? `tunnel ${tunnel}` : ''].filter(Boolean).join(' · '),
  ]
}

function renderDetailCard(state: SupervisorFleetState, width: number, pulse = false): string[] {
  return renderPane('Selection', fleetSelectionDetail(state, pulse), width, false, 2)
}

function renderPane(
  title: string,
  rows: string[],
  width: number,
  focused: boolean,
  rowCount = FLEET_VISIBLE_ROWS,
): string[] {
  const safeWidth = Math.max(12, width)
  const innerWidth = safeWidth - 4
  const titleText = ` ${focused ? '◆ ' : ''}${title} `
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

const FLEET_VISIBLE_ROWS = 5

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

export function displayWidth(value: string): number {
  let width = 0
  for (const { segment } of graphemes(value)) width += graphemeWidth(segment)
  return width
}

export function truncateDisplayWidth(value: string, width: number): string {
  if (width <= 0) return ''
  if (displayWidth(value) <= width) return value
  const ellipsis = '…'
  const budget = Math.max(0, width - graphemeWidth(ellipsis))
  let output = ''
  let used = 0
  for (const { segment } of graphemes(value)) {
    const next = graphemeWidth(segment)
    if (used + next > budget) break
    output += segment
    used += next
  }
  return `${output}${ellipsis}`
}

function graphemes(value: string): Iterable<{ segment: string }> {
  return new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)
}

function graphemeWidth(value: string): number {
  if (/^\p{Mark}+$/u.test(value)) return 0
  if (/\p{Extended_Pictographic}/u.test(value)) return 2
  const code = value.codePointAt(0) ?? 0
  return isWideCodePoint(code) ? 2 : 1
}

function isWideCodePoint(code: number): boolean {
  return code >= 0x1100 && (
    code <= 0x115f
    || code === 0x2329
    || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x20000 && code <= 0x3fffd)
  )
}
