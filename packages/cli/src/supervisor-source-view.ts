import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorActionShelf,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export type SupervisorSourcePhase = 'select' | 'validating' | 'error'

export interface SupervisorSourceLaunchBayView {
  phase: SupervisorSourcePhase
  projectName: string
  provenance: string
  fieldLines: string[]
  detail: string
  contract: string
}

export interface SupervisorSourceLaunchBayRender {
  lines: string[]
}

const WIDE_THRESHOLD = 88
const ROUTE_WIDTH = 34
const GAP = 3

export function supervisorSourceFieldWidth(width: number): number {
  const safeWidth = Math.max(24, width)
  return safeWidth >= WIDE_THRESHOLD
    ? Math.max(1, safeWidth - ROUTE_WIDTH - GAP - 4)
    : Math.max(1, safeWidth - 4)
}

export function renderSupervisorSourceLaunchBay(
  view: SupervisorSourceLaunchBayView,
  width: number,
): SupervisorSourceLaunchBayRender {
  const safeWidth = Math.max(24, width)
  const state = phaseState(view.phase)
  const inspectorRows = [
    '◆ OpenAlice checkout',
    ...view.fieldLines,
    '',
    view.detail,
    '',
    '◆ [ Enter ] Save & start  │  [ Esc ] Cancel',
  ]
  const routeRows = [
    routeRow(state.select, '01 Select'),
    routeRow(state.validate, '02 Validate'),
    routeRow(state.save, '03 Save'),
    routeRow(state.launch, '04 Launch'),
    '',
    `Project · ${view.projectName}`,
    `Source · ${view.provenance}`,
  ]

  if (safeWidth >= WIDE_THRESHOLD) {
    const inspectorWidth = safeWidth - ROUTE_WIDTH - GAP
    const height = Math.max(routeRows.length, inspectorRows.length)
    const route = renderSupervisorPanel(
      'Source route',
      state.signal,
      padRows(routeRows, height),
      ROUTE_WIDTH,
    )
    const inspector = renderSupervisorPanel(
      'Runtime Source',
      'AliceProject setting',
      padRows(inspectorRows, height),
      inspectorWidth,
    )
    return {
      lines: [
        ...route.map((line, index) => joinColumns(
          line,
          inspector[index] ?? '',
          ROUTE_WIDTH,
          GAP,
          safeWidth,
        )),
        '',
        ...renderSupervisorPanel('Launch contract', state.signal, [view.contract], safeWidth),
      ],
    }
  }

  return {
    lines: [
      ...renderSupervisorPanel(
        'Source Launch Bay',
        state.signal,
        [compactRoute(state)],
        safeWidth,
      ),
      '',
      ...renderSupervisorPanel(
        'Runtime Source',
        'AliceProject setting',
        inspectorRows,
        safeWidth,
      ),
      '',
      truncateDisplayWidth(`◆ CONTRACT · ${view.contract}`, safeWidth),
    ],
  }
}

export function decorateSupervisorSourceLaunchBay(
  lines: string[],
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  const action = '◆ [ Enter ] Save & start  │  [ Esc ] Cancel'
  return lines.map((line) => {
    if (line.includes(action)) {
      return line.replace(action, decorateSupervisorActionShelf(action, theme, hoveredCommand))
    }
    if (!theme.enabled) return line
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    if (line.startsWith('│ ◆ ')) return decorateLeftPanel(line, theme.accentStrong)
    if (line.startsWith('│ ! ')) return decorateLeftPanel(line, theme.danger)
    if (line.startsWith('│ ✓ ')) return decorateLeftPanel(line, theme.success)
    return line
  })
}

function phaseState(phase: SupervisorSourcePhase): {
  signal: string
  select: RouteState
  validate: RouteState
  save: RouteState
  launch: RouteState
} {
  if (phase === 'validating') {
    return {
      signal: 'VALIDATING',
      select: 'done',
      validate: 'current',
      save: 'next',
      launch: 'next',
    }
  }
  if (phase === 'error') {
    return {
      signal: 'REJECTED',
      select: 'done',
      validate: 'error',
      save: 'blocked',
      launch: 'blocked',
    }
  }
  return {
    signal: 'SELECT CHECKOUT',
    select: 'current',
    validate: 'next',
    save: 'next',
    launch: 'next',
  }
}

type RouteState = 'done' | 'current' | 'next' | 'error' | 'blocked'

function routeRow(state: RouteState, label: string): string {
  const glyph = state === 'done' ? '✓' : state === 'current' ? '◆' : state === 'error' ? '!' : '·'
  const tail = state === 'done'
    ? 'READY'
    : state === 'current'
      ? 'CURRENT'
      : state === 'error'
        ? 'RETRY'
        : state === 'blocked'
          ? 'BLOCKED'
          : 'NEXT'
  return labelAndTail(`${glyph} ${label}`, tail, ROUTE_WIDTH - 4)
}

function compactRoute(state: ReturnType<typeof phaseState>): string {
  if (state.validate === 'error') return '✓ Select  ! Validate  · Save  · Launch'
  if (state.validate === 'current') return '✓ Select  ◆ Validate  → Save  → Launch'
  return '◆ Select  → Validate  → Save  → Launch'
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

function decorateLeftPanel(line: string, decorate: (value: string) => string): string {
  const boundary = line.indexOf('│', 1)
  if (boundary < 0) return decorate(line)
  return `${decorate(line.slice(0, boundary + 1))}${line.slice(boundary + 1)}`
}
