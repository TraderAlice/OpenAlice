import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export interface SupervisorHelpState {
  selected: number
  hovered: number | null
}

export interface SupervisorHelpTarget {
  index: number
  row: number
  startColumn: number
  endColumn: number
}

export interface SupervisorHelpRender {
  lines: string[]
  targets: SupervisorHelpTarget[]
}

interface HelpGroup {
  glyph: string
  title: string
  summary: string
  description: string
  commands: Array<{ key: string; label: string }>
}

export function createSupervisorHelpState(): SupervisorHelpState {
  return { selected: 0, hovered: null }
}

export function normalizeSupervisorHelpState(
  state: SupervisorHelpState,
  recovery: boolean,
): SupervisorHelpState {
  const count = helpGroups(recovery).length
  return {
    selected: clamp(state.selected, 0, Math.max(0, count - 1)),
    hovered: state.hovered === null
      ? null
      : clamp(state.hovered, 0, Math.max(0, count - 1)),
  }
}

export function moveSupervisorHelpSelection(
  state: SupervisorHelpState,
  delta: number,
  recovery: boolean,
  wrap = true,
): SupervisorHelpState {
  const count = helpGroups(recovery).length
  if (count === 0) return createSupervisorHelpState()
  const selected = wrap
    ? (state.selected + delta % count + count) % count
    : clamp(state.selected + delta, 0, count - 1)
  return { selected, hovered: null }
}

export function selectSupervisorHelpBoundary(
  recovery: boolean,
  end: boolean,
): SupervisorHelpState {
  return {
    selected: end ? Math.max(0, helpGroups(recovery).length - 1) : 0,
    hovered: null,
  }
}

export function renderSupervisorHelp(
  state: SupervisorHelpState,
  recovery: boolean,
  width: number,
): SupervisorHelpRender {
  const groups = helpGroups(recovery)
  const normalized = normalizeSupervisorHelpState(state, recovery)
  const selected = groups[normalized.selected] ?? groups[0]!
  return width >= 96
    ? renderWideHelp(groups, selected, normalized, recovery, width)
    : renderStackedHelp(groups, selected, normalized, recovery, width)
}

function renderWideHelp(
  groups: HelpGroup[],
  selected: HelpGroup,
  state: SupervisorHelpState,
  recovery: boolean,
  width: number,
): SupervisorHelpRender {
  const gap = 3
  const leftWidth = 32
  const rightWidth = width - leftWidth - gap
  const detailRows = detailBody(selected)
  const listRows = groupRows(groups, state)
  while (listRows.length < detailRows.length) listRows.push('')
  const left = renderSupervisorPanel(
    recovery ? 'Safe controls' : 'Control atlas',
    `${state.selected + 1}/${groups.length}`,
    listRows,
    leftWidth,
  )
  const right = renderSupervisorPanel(
    selected.title,
    selected.summary,
    detailRows,
    rightWidth,
  )
  const lines = left.map((line, index) => joinColumns(
    line,
    right[index] ?? '',
    leftWidth,
    gap,
    width,
  ))
  return {
    lines,
    targets: groups.map((_, index) => ({
      index,
      row: index + 2,
      startColumn: 2,
      endColumn: leftWidth - 1,
    })),
  }
}

function renderStackedHelp(
  groups: HelpGroup[],
  selected: HelpGroup,
  state: SupervisorHelpState,
  recovery: boolean,
  width: number,
): SupervisorHelpRender {
  const selectorRows = groupRows(groups, state)
  const lines = renderSupervisorPanel(
    recovery ? 'Safe controls' : 'Control atlas',
    `${state.selected + 1}/${groups.length} · ${selected.title}`,
    [
      ...selectorRows,
      '',
      `${selected.glyph} ${selected.title.toUpperCase()} · ${selected.summary}`,
      selected.description,
      ...selected.commands.map((command) => `[ ${command.key} ] ${command.label}`),
    ],
    width,
  )
  return {
    lines,
    targets: groups.map((_, index) => ({
      index,
      row: index + 2,
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
    })),
  }
}

function groupRows(groups: HelpGroup[], state: SupervisorHelpState): string[] {
  return groups.map((group, index) => {
    const marker = index === state.selected ? '›' : index === state.hovered ? '»' : ' '
    return `${marker} ${group.glyph} ${group.title}  ${group.summary}`
  })
}

function detailBody(group: HelpGroup): string[] {
  return [
    group.description,
    '',
    ...group.commands.map((command) => `[ ${command.key} ] ${command.label}`),
  ]
}

function helpGroups(recovery: boolean): HelpGroup[] {
  if (recovery) {
    return [
      {
        glyph: '◆',
        title: 'Recovery',
        summary: 'Update safely',
        description: 'Project actions stay locked until this CLI can read the configuration.',
        commands: [
          { key: 'u', label: 'Choose a channel, then check and install' },
          { key: '?', label: 'Close safe controls' },
        ],
      },
      {
        glyph: '◇',
        title: 'Exit',
        summary: 'Leave unchanged',
        description: 'Detach without reading or mutating the incompatible AliceProject.',
        commands: [
          { key: 'q / Esc', label: 'Detach only' },
          { key: '?', label: 'Close safe controls' },
        ],
      },
    ]
  }
  return [
    {
      glyph: '◆',
      title: 'Navigation',
      summary: 'Move with intent',
      description: 'Move between views, then explore the focused list or diagnostic surface.',
      commands: [
        { key: 'Tab / →', label: 'Next view' },
        { key: 'Shift+Tab / ←', label: 'Previous view' },
        { key: '↑ / ↓', label: 'Move selection or scroll' },
        { key: 'PgUp / PgDn', label: 'Page operational content' },
      ],
    },
    {
      glyph: '●',
      title: 'Runtime',
      summary: 'Operate locally',
      description: 'Lifecycle stays in this Supervisor; every mutation keeps its confirmation gate.',
      commands: [
        { key: 'Enter', label: 'Run the contextual primary action' },
        { key: 's', label: 'Start quietly' },
        { key: 'o', label: 'Open the Web UI' },
        { key: 'r', label: 'Restart with confirmation' },
        { key: 'x', label: 'Stop with confirmation' },
        { key: 'l', label: 'Open Runtime Logs' },
        { key: 'd', label: 'Open Doctor' },
        { key: 'u', label: 'Check for an update' },
      ],
    },
    {
      glyph: '◇',
      title: 'AliceProject',
      summary: 'Shape the workspace',
      description: 'Choose identity and source here; Workspaces, trading, and chat stay in the Web UI.',
      commands: [
        { key: 'i', label: 'Choose or create an AliceProject' },
        { key: 'p', label: 'Review layered setup' },
        { key: 'c', label: 'Choose the source checkout' },
        { key: 'm', label: 'Transfer or prepare managed source' },
        { key: '/', label: 'Open the Command Palette' },
      ],
    },
  ]
}

function joinColumns(
  left: string,
  right: string,
  leftWidth: number,
  gap: number,
  width: number,
): string {
  const safeLeft = truncateDisplayWidth(left, leftWidth)
  const joined = `${safeLeft}${' '.repeat(Math.max(gap, leftWidth - displayWidth(safeLeft) + gap))}${right}`
  return truncateDisplayWidth(joined, width)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
