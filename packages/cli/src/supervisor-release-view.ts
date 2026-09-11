import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorActionShelf,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export type SupervisorReleaseLane = 'stable' | 'beta' | 'dev'

export interface SupervisorReleaseTarget {
  row: number
  startColumn: number
  endColumn: number
  index: number
}

export interface SupervisorReleaseObservatoryRender {
  lines: string[]
  targets: SupervisorReleaseTarget[]
}

export interface SupervisorReleaseObservatoryView {
  installedVersion: string
  currentLane: SupervisorReleaseLane
  selected: number
}

interface ReleaseLaneModel {
  lane: SupervisorReleaseLane
  label: string
  signal: string
  cadence: string
  audience: string
  tradeoff: string
}

const RELEASE_LANES: ReleaseLaneModel[] = [
  {
    lane: 'stable',
    label: 'Stable',
    signal: '● PRODUCTION',
    cadence: 'accepted stable tags',
    audience: 'everyday installations',
    tradeoff: 'Lowest change rate; manager lane.',
  },
  {
    lane: 'beta',
    label: 'Beta',
    signal: '◈ PREVIEW',
    cadence: 'explicit accepted beta tags',
    audience: 'early feature review',
    tradeoff: 'Early features; beta-only feed.',
  },
  {
    lane: 'dev',
    label: 'Dev',
    signal: '◆ EDGE',
    cadence: 'latest accepted dev archive',
    audience: 'active development testing',
    tradeoff: 'Fastest; archive identity moves.',
  },
]

export function renderSupervisorReleaseObservatory(
  view: SupervisorReleaseObservatoryView,
  width: number,
): SupervisorReleaseObservatoryRender {
  const selected = clamp(view.selected, 0, RELEASE_LANES.length - 1)
  const lane = RELEASE_LANES[selected]!
  const wide = width >= 92
  const gap = 3
  const mapWidth = wide ? Math.max(42, Math.floor(width * 0.45)) : width
  const briefWidth = wide ? Math.max(38, width - mapWidth - gap) : width
  const mapRows = RELEASE_LANES.map((candidate, index) => labelAndTail(
    `${index === selected ? '›' : ' '} ${candidate.label}`,
    candidate.lane === view.currentLane
      ? `CURRENT·${candidate.lane.toUpperCase()}`
      : laneBadge(candidate.lane),
    Math.max(1, mapWidth - 4),
  ))
  const briefRows = [
    `◆ ${lane.label} · ${lane.signal}`,
    `Cadence · ${lane.cadence}`,
    `Audience · ${lane.audience}`,
    `Installed · ${view.installedVersion} · ${lane.lane === view.currentLane ? 'CURRENT LANE' : `${view.currentLane.toUpperCase()} LANE`}`,
    `Tradeoff · ${lane.tradeoff}`,
    '◆ [ Enter ] Check  │  [ Esc ] Cancel',
  ]
  const status = 'Enter probes this lane only; installation still needs confirmation.'

  if (wide) {
    const bodyHeight = Math.max(mapRows.length, briefRows.length)
    const map = renderSupervisorPanel(
      'Release Observatory',
      '3 LANES',
      padRows(mapRows, bodyHeight),
      mapWidth,
    )
    const brief = renderSupervisorPanel(
      'Channel Brief',
      `${selected + 1}/3 · INSTALLED ${view.currentLane.toUpperCase()}`,
      padRows(briefRows, bodyHeight),
      briefWidth,
    )
    return {
      lines: [
        ...map.map((line, index) => joinColumns(
          line,
          brief[index] ?? '',
          mapWidth,
          gap,
          width,
        )),
        '',
        ...renderSupervisorPanel('Update contract', lane.label, [status], width),
      ],
      targets: RELEASE_LANES.map((_, index) => ({
        row: index + 2,
        startColumn: 2,
        endColumn: mapWidth - 1,
        index,
      })),
    }
  }

  const map = renderSupervisorPanel(
    'Release Observatory',
    '3 LANES',
    mapRows,
    width,
  )
  const brief = renderSupervisorPanel(
    'Channel Brief',
    `${selected + 1}/3 · INSTALLED ${view.currentLane.toUpperCase()}`,
    briefRows,
    width,
  )
  return {
    lines: [
      ...map,
      '',
      ...brief,
      '',
      ...renderSupervisorPanel('Update contract', lane.label, [status], width),
    ],
    targets: RELEASE_LANES.map((_, index) => ({
      row: index + 2,
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
      index,
    })),
  }
}

export function decorateSupervisorReleaseObservatory(
  lines: string[],
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  const action = '◆ [ Enter ] Check  │  [ Esc ] Cancel'
  return lines.map((line) => {
    if (line.includes(action)) {
      return line.replace(action, decorateSupervisorActionShelf(action, theme, hoveredCommand))
    }
    if (!theme.enabled) return line
    if (line.includes('◆ EDGE')) return theme.danger(line)
    if (line.includes('◈ PREVIEW')) return theme.warning(line)
    if (line.includes('● PRODUCTION')) return theme.success(line)
    if (line.includes('│ › ')) return theme.selected(line)
    if (line.includes('│ ◆ ')) return theme.accentStrong(line)
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    return line
  })
}

function laneBadge(lane: SupervisorReleaseLane): string {
  if (lane === 'stable') return 'PRODUCTION'
  if (lane === 'beta') return 'PREVIEW'
  return 'EDGE'
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeWidth = Math.max(1, width)
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(safeWidth / 2)))
  const tailWidth = displayWidth(safeTail)
  const safeLabel = truncateDisplayWidth(label, Math.max(1, safeWidth - tailWidth - 1))
  const padding = Math.max(1, safeWidth - displayWidth(safeLabel) - tailWidth)
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
