import { truncateDisplayWidth } from './supervisor-display.ts'
import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export type SupervisorLaunchFlightKind = 'local-start' | 'remote-start' | 'remote-connect'
export type SupervisorLaunchFlightStatus = 'running' | 'failed'
export type SupervisorLaunchStageState = 'complete' | 'active' | 'waiting' | 'failed'

export type SupervisorLaunchStageId =
  | 'validate-target'
  | 'start-runtime'
  | 'refresh-inventory'
  | 'open-forward'
  | 'bind-target'

export interface SupervisorLaunchFlightTarget {
  machineKey: string
  machineName: string
  projectKey: string
  projectName: string
  transport: 'loopback' | 'ssh-forward'
}

export interface SupervisorLaunchStage {
  id: SupervisorLaunchStageId
  label: string
  state: SupervisorLaunchStageState
  detail: string
}

export interface SupervisorLaunchFlight {
  kind: SupervisorLaunchFlightKind
  status: SupervisorLaunchFlightStatus
  target: SupervisorLaunchFlightTarget
  startedAt: number
  stages: SupervisorLaunchStage[]
  failure?: string
}

export function createSupervisorLaunchFlight(
  kind: SupervisorLaunchFlightKind,
  target: SupervisorLaunchFlightTarget,
  startedAt: number,
): SupervisorLaunchFlight {
  return {
    kind,
    status: 'running',
    target: cleanTarget(target),
    startedAt,
    stages: stageDefinitions(kind).map((stage, index) => ({
      ...stage,
      state: index === 0 ? 'active' : 'waiting',
    })),
  }
}

export function advanceSupervisorLaunchFlight(
  flight: SupervisorLaunchFlight,
  stageId: SupervisorLaunchStageId,
  detail?: string,
): SupervisorLaunchFlight {
  const activeIndex = flight.stages.findIndex((stage) => stage.id === stageId)
  if (activeIndex < 0) return flight
  return {
    ...flight,
    status: 'running',
    failure: undefined,
    stages: flight.stages.map((stage, index) => ({
      ...stage,
      state: index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'waiting',
      ...(index === activeIndex && detail ? { detail: cleanValue(detail) } : {}),
    })),
  }
}

export function failSupervisorLaunchFlight(
  flight: SupervisorLaunchFlight,
  failure: string,
): SupervisorLaunchFlight {
  const safeFailure = cleanValue(failure)
  return {
    ...flight,
    status: 'failed',
    failure: safeFailure,
    stages: flight.stages.map((stage) => ({
      ...stage,
      state: stage.state === 'active' ? 'failed' : stage.state,
      ...(stage.state === 'active' ? { detail: safeFailure } : {}),
    })),
  }
}

export function renderSupervisorLaunchFlight(
  flight: SupervisorLaunchFlight,
  width: number,
  now: number,
  targetHeight?: number,
  currentTarget?: SupervisorLaunchFlightTarget,
): string[] {
  const safeWidth = Math.max(24, width)
  const compact = safeWidth < 72
  const elapsed = formatElapsed(Math.max(0, now - flight.startedAt))
  const activeStage = flight.stages.find((stage) => (
    stage.state === 'active' || stage.state === 'failed'
  ))
  const status = flight.status === 'failed' ? 'RECOVERABLE FAILURE' : 'IN FLIGHT'
  const route = `${flight.target.machineName} → ${flight.target.projectName}`
  const switchingFrom = currentTarget
    && (currentTarget.machineKey !== flight.target.machineKey
      || currentTarget.projectKey !== flight.target.projectKey)
    ? currentTarget
    : undefined
  const rows = [
    flight.status === 'failed'
      ? `× ${status} · ${route}`
      : `◆ ${status} · ${route}`,
    ...(switchingFrom
      ? [
          `● FROM  ${switchingFrom.machineName} / ${switchingFrom.projectName} · ${switchingFrom.transport === 'ssh-forward' ? 'SSH' : 'LOCAL'} · LIVE`,
          `◆ TO    ${flight.target.machineName} / ${flight.target.projectName} · ${flight.target.transport === 'ssh-forward' ? 'SSH FORWARD' : 'LOCAL LOOPBACK'}`,
        ]
      : [`⌁ ${flight.target.machineKey}/${flight.target.projectKey} · ${flight.target.transport === 'ssh-forward' ? 'SSH FORWARD' : 'LOCAL LOOPBACK'} · T+${elapsed}`]),
    ...(compact ? [] : ['', renderStageRail(flight.stages, Math.max(1, safeWidth - 4)), '']),
    ...flight.stages.map((stage, index) => renderStageRow(stage, index)),
    '',
    activeStage
      ? `${activeStage.state === 'failed' ? '×' : '◆'} NOW  ${activeStage.label} · ${activeStage.detail}`
      : '✓ NOW  Launch handoff complete',
    flight.status === 'failed'
      ? '◆ [ Enter ] Retry selected target  │  [ Esc ] Back to targets'
      : '◇ CONTROL  Keep this terminal open while the selected launch completes.',
  ]
  const naturalHeight = rows.length + 2
  const quietRows = Number.isFinite(targetHeight)
    ? Math.max(0, Math.floor(targetHeight ?? naturalHeight) - naturalHeight)
    : 0
  if (quietRows > 0) rows.splice(rows.length - 2, 0, ...flightSignalField(quietRows, flight.status))
  return renderSupervisorPanel(
    'Launch Flight Recorder',
    `${flightKindLabel(flight.kind)} · ${status} · T+${elapsed}`,
    rows,
    safeWidth,
  )
}

function stageDefinitions(kind: SupervisorLaunchFlightKind): Array<{
  id: SupervisorLaunchStageId
  label: string
  detail: string
}> {
  if (kind === 'local-start') {
    return [
      { id: 'validate-target', label: 'Validate local target', detail: 'Confirm the selected AliceProject and launch context' },
      { id: 'start-runtime', label: 'Prepare and start Runtime', detail: 'Wait for Guardian and OpenAlice readiness' },
      { id: 'bind-target', label: 'Bind local target', detail: 'Promote the ready loopback endpoint into the workbench' },
    ]
  }
  if (kind === 'remote-start') {
    return [
      { id: 'validate-target', label: 'Revalidate remote target', detail: 'Refresh Machine capability and AliceProject availability' },
      { id: 'start-runtime', label: 'Start remote Runtime', detail: 'Use the registered Machine lifecycle route' },
      { id: 'refresh-inventory', label: 'Refresh remote inventory', detail: 'Wait for the advertised Web endpoint' },
      { id: 'open-forward', label: 'Open SSH forward', detail: 'Create the TUI-owned loopback transport' },
      { id: 'bind-target', label: 'Bind remote target', detail: 'Promote the forwarded endpoint into the workbench' },
    ]
  }
  return [
    { id: 'validate-target', label: 'Validate remote target', detail: 'Confirm Machine reachability and the advertised endpoint' },
    { id: 'open-forward', label: 'Open SSH forward', detail: 'Create the TUI-owned loopback transport' },
    { id: 'bind-target', label: 'Bind remote target', detail: 'Promote the forwarded endpoint into the workbench' },
  ]
}

function renderStageRail(stages: SupervisorLaunchStage[], width: number): string {
  const separator = '  ━━━  '
  const available = Math.max(1, width - (stages.length - 1) * separator.length)
  const stageWidth = Math.max(7, Math.floor(available / stages.length))
  return stages.map((stage, index) => truncateDisplayWidth(
    `${stageGlyph(stage.state)} ${String(index + 1).padStart(2, '0')} ${shortStageLabel(stage.id)}`,
    stageWidth,
  )).join(separator)
}

function renderStageRow(stage: SupervisorLaunchStage, index: number): string {
  const state = stage.state === 'complete'
    ? 'DONE'
    : stage.state === 'active'
      ? 'IN FLIGHT'
      : stage.state === 'failed'
        ? 'FAILED'
        : 'WAITING'
  return `${stageGlyph(stage.state)} ${String(index + 1).padStart(2, '0')}  ${stage.label} · ${state}`
}

function stageGlyph(state: SupervisorLaunchStageState): '✓' | '◆' | '◇' | '×' {
  if (state === 'complete') return '✓'
  if (state === 'active') return '◆'
  if (state === 'failed') return '×'
  return '◇'
}

function shortStageLabel(id: SupervisorLaunchStageId): string {
  if (id === 'validate-target') return 'TARGET'
  if (id === 'start-runtime') return 'START'
  if (id === 'refresh-inventory') return 'REFRESH'
  if (id === 'open-forward') return 'FORWARD'
  return 'BIND'
}

function flightKindLabel(kind: SupervisorLaunchFlightKind): string {
  if (kind === 'local-start') return 'LOCAL START'
  if (kind === 'remote-start') return 'REMOTE START'
  return 'REMOTE CONNECT'
}

function flightSignalField(rows: number, status: SupervisorLaunchFlightStatus): string[] {
  const field = Array.from({ length: rows }, () => '')
  if (rows >= 3) {
    const center = Math.floor(rows / 2)
    field[center - 1] = '                         ·'
    field[center] = status === 'failed'
      ? '                  · ───── × ───── ·'
      : '                  · ━━━━━ ◆ ━━━━━ ·'
    field[center + 1] = '                         ·'
  }
  return field
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function cleanTarget(target: SupervisorLaunchFlightTarget): SupervisorLaunchFlightTarget {
  return {
    ...target,
    machineName: cleanValue(target.machineName),
    projectName: cleanValue(target.projectName),
  }
}

function cleanValue(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}
