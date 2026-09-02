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
  runtime?: {
    class?: string
    state?: string
    owner?: { surface?: string; pid?: number } | null
    provider?: { kind?: string; contentIdentity?: string } | null
    components?: Record<string, string>
    uptimeSeconds?: number
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
  const bodyWidth = Math.max(1, safeWidth - 4)
  const eventLimit = Number.isFinite(targetHeight)
    ? Math.max(1, Math.floor(targetHeight ?? 0) - 8)
    : 1
  const naturalRows = wide
    ? wideObservatoryRows(view, state, action, bodyWidth, eventLimit)
    : compactObservatoryRows(view, state, action, bodyWidth, eventLimit)
  const requestedBodyHeight = Number.isFinite(targetHeight)
    ? Math.max(naturalRows.length, Math.floor(targetHeight ?? 0) - 2)
    : naturalRows.length
  const bodyHeight = Math.max(naturalRows.length, requestedBodyHeight)
  const rows = padActionRows(naturalRows, bodyHeight)
  return renderSupervisorPanel(
    'Runtime Observatory',
    `${state.label} · ${view.target.kind === 'ssh' ? 'REMOTE' : 'LOCAL'} · ${view.events.length}/${MAX_CONNECTION_EVENTS} EVENTS`,
    rows,
    safeWidth,
  )
}

function wideObservatoryRows(
  view: SupervisorConnectionChronicleView,
  state: ReturnType<typeof connectionPhasePresentation>,
  action: { key: string; label: string },
  width: number,
  eventLimit: number,
): string[] {
  const divider = ' │ '
  const available = Math.max(3, width - displayWidth(divider) * 2)
  const runtimeWidth = Math.max(22, Math.floor(available * 0.28))
  const routeWidth = Math.max(30, Math.floor(available * 0.39))
  const servicesWidth = Math.max(1, available - runtimeWidth - routeWidth)
  const services = serviceRows(view.target.runtime?.components)
  return [
    composeColumns('RUNTIME', 'ROUTE', 'SERVICES', runtimeWidth, routeWidth, servicesWidth, divider),
    composeColumns(
      runtimeStateRow(view.target, state),
      `⌁ ${cleanValue(view.target.machineName)} → ${cleanValue(view.target.projectName)}`,
      services[0]!,
      runtimeWidth,
      routeWidth,
      servicesWidth,
      divider,
    ),
    composeColumns(
      ownerRow(view.target),
      `↗ ${cleanValue(view.target.endpoint)}`,
      services[1]!,
      runtimeWidth,
      routeWidth,
      servicesWidth,
      divider,
    ),
    composeColumns(
      providerRow(view.target),
      checkRow(view.target),
      services[2]!,
      runtimeWidth,
      routeWidth,
      servicesWidth,
      divider,
    ),
    composeColumns(
      uptimeRow(view.target),
      `Last check  ${formatCheckedAt(view.target.health?.checkedAt)}`,
      `History  ${view.events.length}/${MAX_CONNECTION_EVENTS}`,
      runtimeWidth,
      routeWidth,
      servicesWidth,
      divider,
    ),
    ...observatoryEventRows(view.events, eventLimit, true),
    `◆ [ ${action.key} ] ${action.label}`,
  ]
}

function compactObservatoryRows(
  view: SupervisorConnectionChronicleView,
  state: ReturnType<typeof connectionPhasePresentation>,
  action: { key: string; label: string },
  width: number,
  eventLimit: number,
): string[] {
  return [
    runtimeStateRow(view.target, state),
    `⌁ ${cleanValue(view.target.machineName)} → ${cleanValue(view.target.projectName)} · ${transportLabel(view.target)}`,
    `${ownerRow(view.target)} · ${uptimeRow(view.target)}`,
    providerRow(view.target),
    `↗ ${cleanValue(view.target.endpoint)}`,
    truncateDisplayWidth(`SERVICES  ${serviceRows(view.target.runtime?.components).join(' · ')}`, width),
    ...observatoryEventRows(view.events, eventLimit, false),
    `◆ [ ${action.key} ] ${action.label}`,
  ]
}

function observatoryEventRows(
  events: SupervisorConnectionEvent[],
  limit: number,
  wide: boolean,
): string[] {
  const recent = events.slice(-Math.max(1, limit)).reverse()
  if (recent.length === 0) return ['RECENT  · No connection changes in this session']
  return recent.map((event, index) => (
    `${index === 0 ? 'RECENT' : '      '}  ${wide ? wideEventRow(event) : compactEventRow(event)}`
  ))
}

function runtimeStateRow(
  target: SupervisorConnectionChronicleTarget,
  state: ReturnType<typeof connectionPhasePresentation>,
): string {
  const runtimeState = cleanValue(target.runtime?.state ?? target.runtime?.class ?? 'state not reported').toUpperCase()
  return `${state.glyph} OPENALICE ${runtimeState} · ${state.label}`
}

function ownerRow(target: SupervisorConnectionChronicleTarget): string {
  const owner = target.runtime?.owner
  if (!owner?.surface) return 'Owner  not reported'
  return `Owner  ${cleanValue(owner.surface)}${Number.isInteger(owner.pid) ? ` · pid ${owner.pid}` : ''}`
}

function providerRow(target: SupervisorConnectionChronicleTarget): string {
  const provider = target.runtime?.provider
  if (!provider?.kind || provider.kind === 'unknown') return 'Provider  not reported'
  return `Provider  ${cleanValue(provider.kind)}${provider.contentIdentity ? ` · ${cleanValue(provider.contentIdentity)}` : ''}`
}

function uptimeRow(target: SupervisorConnectionChronicleTarget): string {
  const seconds = target.runtime?.uptimeSeconds
  return `Uptime  ${Number.isFinite(seconds) ? formatDuration(Math.max(0, seconds ?? 0)) : 'not reported'}`
}

function checkRow(target: SupervisorConnectionChronicleTarget): string {
  const failures = target.health?.consecutiveFailures ?? 0
  return `Checks  ${failures} failed ${target.kind === 'ssh' ? 'probes' : 'inspections'}`
}

function transportLabel(target: SupervisorConnectionChronicleTarget): string {
  return target.transport === 'ssh-forward' ? 'SSH FORWARD' : 'LOCAL LOOPBACK'
}

function serviceRows(components?: Record<string, string>): [string, string, string] {
  return (['alice', 'uta', 'connector'] as const).map((key) => {
    const label = key === 'alice' ? 'Alice' : key === 'uta' ? 'UTA' : 'Connector'
    const value = cleanValue(components?.[key] ?? 'not reported')
    const normalized = value.toLowerCase()
    const glyph = /\b(?:ready|running|connected|healthy|live)\b/u.test(normalized)
      ? '●'
      : /\b(?:failed|error|unhealthy|unreachable)\b/u.test(normalized)
        ? '×'
        : /\b(?:disabled|stopped|absent|off)\b/u.test(normalized)
          ? '○'
          : '◇'
    return `${glyph} ${label}  ${value}`
  }) as [string, string, string]
}

function composeColumns(
  left: string,
  center: string,
  right: string,
  leftWidth: number,
  centerWidth: number,
  rightWidth: number,
  divider: string,
): string {
  return [
    fillColumn(left, leftWidth),
    fillColumn(center, centerWidth),
    truncateDisplayWidth(right, rightWidth),
  ].join(divider)
}

function fillColumn(value: string, width: number): string {
  const safe = truncateDisplayWidth(value, width)
  return `${safe}${' '.repeat(Math.max(0, width - displayWidth(safe)))}`
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

function formatDuration(value: number): string {
  const seconds = Math.floor(value)
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

function cleanValue(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function padActionRows(rows: string[], height: number): string[] {
  if (rows.length >= height) return rows.slice(0, height)
  const action = rows.at(-1) ?? ''
  return [
    ...rows.slice(0, -1),
    ...Array.from({ length: Math.max(0, height - rows.length) }, () => ''),
    action,
  ]
}
