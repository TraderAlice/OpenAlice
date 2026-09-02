import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export type SupervisorConnectionPhase = 'connected' | 'checking' | 'degraded' | 'unreachable'

export type SupervisorConnectionEventKind =
  | 'connected'
  | 'degraded'
  | 'unreachable'
  | 'recovered'
  | 'disconnected'
  | 'stopped'

export type SupervisorConnectionEventOrigin =
  | 'startup'
  | 'local-inspection'
  | 'automatic-probe'
  | 'manual-retry'
  | 'ssh-forward'
  | 'target-switch'
  | 'user-disconnect'
  | 'tunnel-exit'

export interface SupervisorConnectionChronicleTarget {
  kind: 'local' | 'ssh'
  machineKey: string
  machineName: string
  projectKey: string
  projectName: string
  transport: 'loopback' | 'ssh-forward'
  endpoint: string
  health?: {
    phase: SupervisorConnectionPhase
    consecutiveFailures: number
    checkedAt?: number
  }
}

export interface SupervisorConnectionEvent {
  at: number
  kind: SupervisorConnectionEventKind
  origin: SupervisorConnectionEventOrigin
  machineKey: string
  machineName: string
  projectKey: string
  projectName: string
  transport: 'loopback' | 'ssh-forward'
}

export interface SupervisorConnectionChronicleView {
  target: SupervisorConnectionChronicleTarget
  events: SupervisorConnectionEvent[]
}

const MAX_CONNECTION_EVENTS = 12

export function createSupervisorConnectionEvent(
  kind: SupervisorConnectionEventKind,
  target: SupervisorConnectionChronicleTarget,
  at: number,
  origin: SupervisorConnectionEventOrigin,
): SupervisorConnectionEvent {
  return {
    at,
    kind,
    origin,
    machineKey: target.machineKey,
    machineName: cleanValue(target.machineName),
    projectKey: target.projectKey,
    projectName: cleanValue(target.projectName),
    transport: target.transport,
  }
}

export function appendSupervisorConnectionEvent(
  events: SupervisorConnectionEvent[],
  event: SupervisorConnectionEvent,
): SupervisorConnectionEvent[] {
  const previous = events.at(-1)
  if (previous
    && previous.kind === event.kind
    && previous.machineKey === event.machineKey
    && previous.projectKey === event.projectKey
    && previous.origin === event.origin) {
    return events
  }
  return [...events, event].slice(-MAX_CONNECTION_EVENTS)
}

export function renderSupervisorConnectionChronicle(
  view: SupervisorConnectionChronicleView,
  width: number,
  targetHeight?: number,
): string[] {
  const safeWidth = Math.max(24, width)
  const wide = safeWidth >= 100
  const phase = view.target.health?.phase ?? 'connected'
  const action = phase === 'connected'
    ? { key: 'o', label: 'Open verified Web UI' }
    : { key: 'r', label: 'Retry active connection' }
  const state = connectionPhasePresentation(phase)

  if (!wide) {
    const recent = view.events.slice(-2).reverse()
    const rows = [
      `${state.glyph} ${state.label} · ${view.target.transport === 'ssh-forward' ? 'SSH FORWARD' : 'LOOPBACK'}`,
      `⌁ ${cleanValue(view.target.machineName)} → ${cleanValue(view.target.projectName)}`,
      ...recent.map((event) => compactEventRow(event)),
    ]
    while (rows.length < 4) rows.push('· No earlier connection transition in this session')
    rows.push(`◆ [ ${action.key} ] ${action.label}`)
    return renderSupervisorPanel(
      'Connection Chronicle',
      `${state.label} · ${view.events.length}/${MAX_CONNECTION_EVENTS}`,
      rows,
      safeWidth,
    )
  }

  const gap = 3
  const currentWidth = Math.max(48, Math.floor(safeWidth * 0.46))
  const trailWidth = Math.max(36, safeWidth - currentWidth - gap)
  const naturalBodyHeight = 7
  const bodyHeight = Number.isFinite(targetHeight)
    ? Math.max(naturalBodyHeight, Math.floor(targetHeight ?? 0) - 2)
    : naturalBodyHeight
  const currentRows = padRows([
    `${state.glyph} ${state.label} · ${view.target.transport === 'ssh-forward' ? 'SSH FORWARD RETAINED' : 'LOCAL LOOPBACK'}`,
    `Machine       ${cleanValue(view.target.machineName)} · ${view.target.machineKey}`,
    `AliceProject  ${cleanValue(view.target.projectName)} · ${view.target.projectKey}`,
    `Endpoint      ${cleanValue(view.target.endpoint)}`,
    `Checks        ${view.target.health?.consecutiveFailures ?? 0} failed ${view.target.kind === 'ssh' ? 'probes' : 'inspections'}`,
    `Last check    ${formatCheckedAt(view.target.health?.checkedAt)}`,
    `◆ [ ${action.key} ] ${action.label}`,
  ], bodyHeight)
  const visibleEvents = view.events.slice(-bodyHeight).reverse()
  const trailRows = padRows(visibleEvents.length > 0
    ? visibleEvents.map((event) => wideEventRow(event))
    : ['◇ No connection transitions recorded in this TUI session.'], bodyHeight)
  const current = renderSupervisorPanel(
    'Active Link',
    `${state.label} · ${view.target.kind === 'ssh' ? 'REMOTE' : 'LOCAL'}`,
    currentRows,
    currentWidth,
  )
  const trail = renderSupervisorPanel(
    'Session Trail',
    `${view.events.length}/${MAX_CONNECTION_EVENTS} · NEWEST FIRST`,
    trailRows,
    trailWidth,
  )
  return current.map((line, index) => joinColumns(
    line,
    trail[index] ?? '',
    currentWidth,
    gap,
    safeWidth,
  ))
}

function connectionPhasePresentation(phase: SupervisorConnectionPhase): {
  glyph: '●' | '◌' | '!' | '×'
  label: string
} {
  if (phase === 'checking') return { glyph: '◌', label: 'CHECKING ENDPOINT' }
  if (phase === 'degraded') return { glyph: '!', label: 'CONNECTION DEGRADED' }
  if (phase === 'unreachable') return { glyph: '×', label: 'ENDPOINT UNREACHABLE' }
  return { glyph: '●', label: 'CONNECTED' }
}

function eventPresentation(kind: SupervisorConnectionEventKind): {
  glyph: '●' | '!' | '×' | '✓' | '○'
  label: string
} {
  if (kind === 'degraded') return { glyph: '!', label: 'DEGRADED' }
  if (kind === 'unreachable') return { glyph: '×', label: 'UNREACHABLE' }
  if (kind === 'recovered') return { glyph: '✓', label: 'RECOVERED' }
  if (kind === 'disconnected') return { glyph: '○', label: 'RELEASED' }
  if (kind === 'stopped') return { glyph: '○', label: 'STOPPED' }
  return { glyph: '●', label: 'ACQUIRED' }
}

function compactEventRow(event: SupervisorConnectionEvent): string {
  const presentation = eventPresentation(event.kind)
  return `${presentation.glyph} ${formatClock(event.at)} ${presentation.label} · ${originLabel(event.origin)}`
}

function wideEventRow(event: SupervisorConnectionEvent): string {
  const presentation = eventPresentation(event.kind)
  return `${presentation.glyph} ${formatClock(event.at)} ${presentation.label} · ${originLabel(event.origin)} · ${cleanValue(event.machineName)}/${cleanValue(event.projectName)}`
}

function originLabel(origin: SupervisorConnectionEventOrigin): string {
  if (origin === 'startup') return 'startup discovery'
  if (origin === 'local-inspection') return 'local inspection'
  if (origin === 'automatic-probe') return 'automatic probe'
  if (origin === 'manual-retry') return 'manual retry'
  if (origin === 'ssh-forward') return 'SSH forward ready'
  if (origin === 'target-switch') return 'target switch'
  if (origin === 'user-disconnect') return 'user disconnect'
  return 'tunnel exit'
}

function formatClock(value: number): string {
  const date = new Date(value)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

function formatCheckedAt(value?: number): string {
  return value === undefined ? 'startup discovery' : formatClock(value)
}

function cleanValue(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function padRows(rows: string[], height: number): string[] {
  return [...rows.slice(0, height), ...Array.from({ length: Math.max(0, height - rows.length) }, () => '')]
}

function joinColumns(
  left: string,
  right: string,
  leftWidth: number,
  gap: number,
  totalWidth: number,
): string {
  const safeLeft = truncateDisplayWidth(left, leftWidth)
  const leftPadding = ' '.repeat(Math.max(0, leftWidth - displayWidth(safeLeft)))
  return truncateDisplayWidth(`${safeLeft}${leftPadding}${' '.repeat(gap)}${right}`, totalWidth)
}
