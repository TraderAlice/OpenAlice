import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import { supervisorVisibleListIndexes } from './supervisor-overlay-pointer.ts'
import { withSupervisorScrollRail } from './supervisor-scroll-rail.ts'
import {
  decorateSupervisorActionShelf,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
import { renderSupervisorPanel, wrapDisplayText } from './supervisor-tui-view.ts'

export interface SupervisorProjectSwitchboardItem {
  key: string
  label: string
  kind: 'project' | 'create'
  home?: string
  port?: number
  portAutomatic?: boolean
  current?: boolean
  isDefault?: boolean
}

export interface SupervisorProjectSwitchboardTarget {
  row: number
  startColumn: number
  endColumn: number
  index: number
}

export interface SupervisorProjectSwitchboardRender {
  lines: string[]
  targets: SupervisorProjectSwitchboardTarget[]
}

export interface SupervisorProjectSwitchboardView {
  currentProjectName: string
  message: string
  locked: boolean
  items: SupervisorProjectSwitchboardItem[]
  selected: number
  maxVisible?: number
}

const MAX_WIDE_PROJECTS = 8
const MAX_NARROW_PROJECTS = 5

export function renderSupervisorProjectSwitchboard(
  view: SupervisorProjectSwitchboardView,
  width: number,
  compactStage = false,
): SupervisorProjectSwitchboardRender {
  const selected = clamp(view.selected, 0, Math.max(0, view.items.length - 1))
  const item = view.items[selected]
  if (!item) {
    return {
      lines: renderSupervisorPanel('AliceProject Switchboard', view.currentProjectName, [
        'No AliceProjects are available.',
        '◆ [ Esc ] Done',
      ], width),
      targets: [],
    }
  }

  const wide = width >= 92
  const gap = 3
  const mapWidth = wide ? Math.max(43, Math.floor(width * 0.49)) : width
  const inspectorWidth = wide ? Math.max(36, width - mapWidth - gap) : width
  const mapInnerWidth = Math.max(1, mapWidth - 4)
  const visibleIndexes = supervisorVisibleListIndexes(
    selected,
    view.items.length,
    Math.max(1, Math.min(
      wide ? MAX_WIDE_PROJECTS : MAX_NARROW_PROJECTS,
      view.maxVisible ?? (wide ? MAX_WIDE_PROJECTS : MAX_NARROW_PROJECTS),
    )),
  )
  const mapRows = withSupervisorScrollRail(
    visibleIndexes.map((index) => {
      const candidate = view.items[index]!
      return labelAndTail(
        `${index === selected ? '›' : ' '} ${candidate.label}`,
        projectBadge(candidate),
        mapInnerWidth - (view.items.length > visibleIndexes.length ? 1 : 0),
      )
    }),
    mapInnerWidth,
    {
      offset: visibleIndexes[0] ?? 0,
      total: view.items.length,
    },
  )
  const inspectorRows = projectInspectorRows(item, selected, view.items.length, view.locked, inspectorWidth)
  const projectCount = view.items.filter((candidate) => candidate.kind === 'project').length
  const projectCountLabel = `${projectCount} ${projectCount === 1 ? 'PROJECT' : 'PROJECTS'}`
  const mode = view.locked ? 'READ ONLY' : 'SELECT & CREATE'
  const statusRows = wrapDisplayText(view.message, Math.max(1, width - 4)).slice(0, 2)

  if (wide) {
    const bodyHeight = Math.max(mapRows.length, inspectorRows.length)
    const map = renderSupervisorPanel(
      'AliceProject Switchboard',
      projectCountLabel,
      padRows(mapRows, bodyHeight),
      mapWidth,
    )
    const inspector = renderSupervisorPanel(
      'Inspector',
      `${selected + 1}/${view.items.length} · ${mode}`,
      padRows(inspectorRows, bodyHeight),
      inspectorWidth,
    )
    return {
      lines: [
        ...map.map((line, index) => joinColumns(
          line,
          inspector[index] ?? '',
          mapWidth,
          gap,
          width,
        )),
        '',
        ...renderSupervisorPanel('Switchboard status', view.currentProjectName, statusRows, width),
      ],
      targets: visibleIndexes.map((index, row) => ({
        row: row + 2,
        startColumn: 2,
        endColumn: mapWidth - 1,
        index,
      })),
    }
  }

  const map = renderSupervisorPanel(
    'AliceProject Switchboard',
    projectCountLabel,
    mapRows,
    width,
  )
  const inspector = renderSupervisorPanel(
    'Inspector',
    `${selected + 1}/${view.items.length} · ${mode}`,
    inspectorRows,
    width,
  )
  const compactStatusRows = wrapDisplayText(
    `${view.currentProjectName} · ${view.message}`,
    Math.max(1, width - 2),
  ).slice(0, 2).map((line, index) => `${index === 0 ? '◇' : ' '} ${line}`)
  const targets = visibleIndexes.map((index, row) => ({
    row: row + 2,
    startColumn: 2,
    endColumn: Math.max(2, width - 1),
    index,
  }))
  if (!compactStage) {
    return {
      lines: [
        ...map,
        '',
        ...inspector,
        '',
        ...renderSupervisorPanel('Switchboard status', view.currentProjectName, statusRows, width),
      ],
      targets,
    }
  }
  return {
    lines: [
      ...map,
      '',
      ...inspector,
      ...compactStatusRows.map((line) => truncateDisplayWidth(line, width)),
    ],
    targets,
  }
}

export function decorateSupervisorProjectSwitchboard(
  lines: string[],
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  const actions = [
    '◆ [ Enter ] Create  │  [ Esc ] Done',
    '◆ [ Enter ] Select  │  [ Esc ] Done',
    '◆ [ Enter ] Keep  │  [ Esc ] Done',
    '◆ [ Esc ] Done',
  ]
  return lines.map((line) => {
    const action = actions.find((candidate) => line.includes(candidate))
    if (action) {
      return line.replace(action, decorateSupervisorActionShelf(action, theme, hoveredCommand))
    }
    if (!theme.enabled) return line
    if (line.includes('│ › ')) return theme.selected(line)
    if (line.includes('│ ◆ ')) return theme.accentStrong(line)
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    return line
  })
}

function projectInspectorRows(
  item: SupervisorProjectSwitchboardItem,
  selected: number,
  total: number,
  locked: boolean,
  width: number,
): string[] {
  const contentWidth = Math.max(1, width - 4)
  if (item.kind === 'create') {
    const description = wrapDisplayText(
      'Register a named AliceProject with its own complete Home.',
      contentWidth,
    ).slice(0, 2)
    return rowsWithBottomAction([
      `◆ New AliceProject · ${selected + 1}/${total}`,
      'Home · separate and complete',
      ...description,
    ], '◆ [ Enter ] Create  │  [ Esc ] Done', 6)
  }

  const role = [
    item.current ? 'CURRENT CONTEXT' : undefined,
    item.isDefault ? 'BARE-START DEFAULT' : undefined,
  ].filter(Boolean).join(' · ') || 'AVAILABLE'
  const action = locked
    ? '◆ [ Esc ] Done'
    : item.current && item.isDefault
      ? '◆ [ Enter ] Keep  │  [ Esc ] Done'
      : '◆ [ Enter ] Select  │  [ Esc ] Done'
  return padRows([
    `◆ ${item.label} · ${selected + 1}/${total}`,
    `Home · ${item.home ?? 'not resolved'}`,
    `Web · ${item.portAutomatic ? `automatic from ${item.port ?? 'unknown'}` : item.port ?? 'unknown'}`,
    `Role · ${role}`,
    locked ? 'Selection is locked by the current launch override.' : 'Enter selects this context and remembers it for bare starts.',
    action,
  ], 6)
}

function projectBadge(item: SupervisorProjectSwitchboardItem): string {
  if (item.kind === 'create') return 'NEW'
  if (item.current && item.isDefault) return 'CURRENT·DEFAULT'
  if (item.current) return 'CURRENT'
  if (item.isDefault) return 'DEFAULT'
  return 'READY'
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeWidth = Math.max(1, width)
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(safeWidth / 2)))
  const tailWidth = displayWidth(safeTail)
  const safeLabel = truncateDisplayWidth(label, Math.max(1, safeWidth - tailWidth - 1))
  const gap = Math.max(1, safeWidth - displayWidth(safeLabel) - tailWidth)
  return `${safeLabel}${' '.repeat(gap)}${safeTail}`
}

function padRows(rows: string[], height: number): string[] {
  return [...rows, ...Array.from({ length: Math.max(0, height - rows.length) }, () => '')]
}

function rowsWithBottomAction(rows: string[], action: string, height: number): string[] {
  return [
    ...rows,
    ...Array.from({ length: Math.max(0, height - rows.length - 1) }, () => ''),
    action,
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
  const combined = `${safeLeft}${' '.repeat(Math.max(0, leftWidth - displayWidth(safeLeft) + gap))}${right}`
  return truncateDisplayWidth(combined, width)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
