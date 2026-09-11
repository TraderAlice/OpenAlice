import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorActionShelf,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export type SupervisorProjectFoundryStep = 'identity' | 'home' | 'workspaces'

export interface SupervisorProjectFoundryView {
  step: SupervisorProjectFoundryStep
  currentProjectName: string
  projectKey?: string
  fieldLines: string[]
  detail: string
  message: string
}

export interface SupervisorProjectFoundryRender {
  lines: string[]
}

const WIDE_THRESHOLD = 92
const PATH_WIDTH = 36
const GAP = 3

export function supervisorProjectFoundryFieldWidth(width: number): number {
  const safeWidth = Math.max(24, width)
  return safeWidth >= WIDE_THRESHOLD
    ? Math.max(1, safeWidth - PATH_WIDTH - GAP - 4)
    : Math.max(1, safeWidth - 4)
}

export function renderSupervisorProjectFoundry(
  view: SupervisorProjectFoundryView,
  width: number,
): SupervisorProjectFoundryRender {
  const safeWidth = Math.max(24, width)
  const home = view.step === 'home'
  const workspaces = view.step === 'workspaces'
  const active = workspaces ? 2 : home ? 1 : 0
  const signal = workspaces ? 'WORKSPACES' : home ? 'COMPLETE HOME' : 'IDENTITY'
  const field = workspaces ? 'Choose workspaces' : home ? 'Complete home' : 'AliceProject key'
  const action = workspaces
    ? '◆ [ Enter ] Create & start  │  [ Esc ] Back'
    : '◆ [ Enter ] Continue  │  [ Esc ] Back'
  const inspectorRows = [
    `◆ ${field}`,
    ...view.fieldLines,
    '',
    view.detail,
    '',
    action,
  ]

  if (safeWidth >= WIDE_THRESHOLD) {
    const inspectorWidth = safeWidth - PATH_WIDTH - GAP
    const height = Math.max(5, inspectorRows.length)
    const path = renderSupervisorPanel(
      'Foundry',
      `${active + 1}/3 · ${signal}`,
      padRows([
        labelAndTail(`${active > 0 ? '✓' : '◆'} 01 Identity`, active > 0 ? 'DONE' : 'CURRENT', PATH_WIDTH - 4),
        labelAndTail(`${workspaces ? '✓' : home ? '◆' : '·'} 02 Complete Home`, workspaces ? 'DONE' : home ? 'CURRENT' : 'NEXT', PATH_WIDTH - 4),
        labelAndTail(`${workspaces ? '◆' : '·'} 03 Workspaces`, workspaces ? 'CURRENT' : 'NEXT', PATH_WIDTH - 4),
        '',
        `From · ${view.currentProjectName}`,
        home ? `Key · ${view.projectKey ?? 'pending'}` : 'Key · not reserved yet',
      ], height),
      PATH_WIDTH,
    )
    const inspector = renderSupervisorPanel(
      'Create AliceProject',
      active > 0 ? view.projectKey ?? 'Workspaces' : 'Project key',
      padRows(inspectorRows, height),
      inspectorWidth,
    )
    return {
      lines: [
        ...path.map((line, index) => joinColumns(
          line,
          inspector[index] ?? '',
          PATH_WIDTH,
          GAP,
          safeWidth,
        )),
        '',
        ...renderSupervisorPanel('Foundry contract', signal, [view.message], safeWidth),
      ],
    }
  }

  const route = workspaces
    ? '✓ Identity  ✓ Home  ◆ Workspaces'
    : home
    ? '✓ Identity  ◆ Home  → Workspaces'
    : '◆ Identity  → Home  → Workspaces'
  return {
    lines: [
      ...renderSupervisorPanel('AliceProject Foundry', `${active + 1}/3 · ${signal}`, [route], safeWidth),
      '',
      ...renderSupervisorPanel(
        'Create AliceProject',
        active > 0 ? view.projectKey ?? 'Workspaces' : 'Project key',
        inspectorRows,
        safeWidth,
      ),
      '',
      truncateDisplayWidth(`◆ CONTRACT · ${view.message}`, safeWidth),
    ],
  }
}

export function decorateSupervisorProjectFoundry(
  lines: string[],
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  const actions = [
    '◆ [ Enter ] Create & start  │  [ Esc ] Back',
    '◆ [ Enter ] Continue  │  [ Esc ] Back',
  ]
  return lines.map((line) => {
    for (const action of actions) {
      if (line.includes(action)) {
        return line.replace(action, decorateSupervisorActionShelf(action, theme, hoveredCommand))
      }
    }
    if (!theme.enabled) return line
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    if (line.startsWith('│ ◆ ')) return decorateLeftPanel(line, theme.accentStrong)
    if (line.startsWith('│ ✓ 01 Identity')) return decorateLeftPanel(line, theme.success)
    return line
  })
}

function decorateLeftPanel(line: string, decorate: (value: string) => string): string {
  const boundary = line.indexOf('│', 1)
  if (boundary < 0) return decorate(line)
  return `${decorate(line.slice(0, boundary + 1))}${line.slice(boundary + 1)}`
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(width / 2)))
  const safeLabel = truncateDisplayWidth(label, Math.max(1, width - displayWidth(safeTail) - 1))
  const padding = Math.max(1, width - displayWidth(safeLabel) - displayWidth(safeTail))
  return `${safeLabel}${' '.repeat(padding)}${safeTail}`
}

function padRows(rows: string[], height: number): string[] {
  return [...rows, ...Array.from({ length: Math.max(0, height - rows.length) }, () => '')]
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
