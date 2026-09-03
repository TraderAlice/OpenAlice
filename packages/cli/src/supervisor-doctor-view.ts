import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import {
  supervisorScrollRailIndexAt,
  withSupervisorScrollRail,
  type SupervisorScrollRailTarget,
} from './supervisor-scroll-rail.ts'
import { renderSupervisorPanel, renderSupervisorSignalScope } from './supervisor-tui-view.ts'

export interface SupervisorDoctorCheck {
  status?: string
  summary?: string
  detail?: string
}

export interface SupervisorDoctorReport {
  overall?: string
  summary?: {
    passed?: number
    warnings?: number
    failures?: number
  }
  checks?: SupervisorDoctorCheck[]
}

export interface SupervisorDoctorState {
  selected: number
  hovered: number | null
}

export interface SupervisorDoctorTarget {
  /** 1-based row inside the complete Doctor rendering. */
  row: number
  startColumn: number
  endColumn: number
  index: number
}

export interface SupervisorDoctorRender {
  lines: string[]
  targets: SupervisorDoctorTarget[]
  railTargets: SupervisorScrollRailTarget[]
}

export function createSupervisorDoctorState(
  report?: SupervisorDoctorReport | null,
): SupervisorDoctorState {
  const checks = report?.checks ?? []
  const failed = checks.findIndex((check) => doctorStatus(check.status).kind === 'fail')
  if (failed >= 0) return { selected: failed, hovered: null }
  const warned = checks.findIndex((check) => doctorStatus(check.status).kind === 'warn')
  return { selected: warned >= 0 ? warned : 0, hovered: null }
}

export function normalizeSupervisorDoctorState(
  state: SupervisorDoctorState,
  report?: SupervisorDoctorReport | null,
): SupervisorDoctorState {
  const count = report?.checks?.length ?? 0
  if (count <= 0) return { selected: 0, hovered: null }
  return {
    selected: clamp(state.selected, 0, count - 1),
    hovered: state.hovered === null ? null : clamp(state.hovered, 0, count - 1),
  }
}

export function moveSupervisorDoctorSelection(
  state: SupervisorDoctorState,
  delta: number,
  report?: SupervisorDoctorReport | null,
  wrap = true,
): SupervisorDoctorState {
  const count = report?.checks?.length ?? 0
  if (count <= 0) return { selected: 0, hovered: null }
  const selected = wrap
    ? (state.selected + delta % count + count) % count
    : clamp(state.selected + delta, 0, count - 1)
  return { selected, hovered: null }
}

export function selectSupervisorDoctorBoundary(
  report: SupervisorDoctorReport | null | undefined,
  end: boolean,
): SupervisorDoctorState {
  return {
    selected: end ? Math.max(0, (report?.checks?.length ?? 1) - 1) : 0,
    hovered: null,
  }
}

export function renderSupervisorDoctor(
  report: SupervisorDoctorReport | null | undefined,
  state: SupervisorDoctorState,
  width: number,
  targetHeight?: number,
  hoveredRailRow: number | null = null,
): SupervisorDoctorRender {
  if (!report) {
    return {
      lines: renderSupervisorSignalScope({
        title: 'Diagnostic Radar',
        meta: 'STANDBY',
        glyph: '◇',
        state: 'DOCTOR STANDBY',
        facts: [
          {
            label: 'Mode',
            value: 'Read-only Runtime diagnostics',
            compactValue: 'Read-only diagnostics',
          },
          {
            label: 'Scope',
            value: 'Lifecycle · ownership · paths · dependencies',
            compactValue: 'Runtime · ownership · paths',
          },
          {
            label: 'Writes',
            value: 'None · no repair or state mutation',
            compactValue: 'None',
          },
        ],
        action: { key: 'd', label: 'Run Runtime Doctor', compactLabel: 'Run Doctor' },
      }, width, targetHeight),
      targets: [],
      railTargets: [],
    }
  }
  const checks = report.checks ?? []
  if (checks.length === 0) {
    return {
      lines: renderSupervisorSignalScope({
        title: 'Diagnostic Radar',
        meta: `NO CHECKS · ${doctorCompactMeta(report)}`,
        glyph: '○',
        state: 'NO CHECKS',
        facts: [
          {
            label: 'Report',
            value: `Loaded · ${doctorMeta(report)}`,
            compactValue: `Loaded · ${doctorCompactMeta(report)}`,
          },
          { label: 'Result', value: 'No diagnostic checks returned' },
          {
            label: 'Writes',
            value: 'None · report remains read-only',
            compactValue: 'None',
          },
        ],
        action: { key: 'd', label: 'Rerun Runtime Doctor', compactLabel: 'Rerun Doctor' },
      }, width, targetHeight),
      targets: [],
      railTargets: [],
    }
  }

  const normalized = normalizeSupervisorDoctorState(state, report)
  if (width < 60 && Number.isFinite(targetHeight)) {
    return renderEmergencyDoctor(report, normalized, width)
  }
  const wide = width >= 100
  const baselineVisible = wide ? 10 : width < 60 ? 4 : 5
  const visible = wide && Number.isFinite(targetHeight)
    ? Math.max(baselineVisible, Math.floor(targetHeight ?? 0) - 2)
    : baselineVisible
  const start = windowStart(normalized.selected, checks.length, visible)
  const end = Math.min(checks.length, start + visible)
  const railViewportRows = end - start
  const railVisible = checks.length > railViewportRows
  const listRows = withSupervisorScrollRail(checks.slice(start, end).map((check, relativeIndex) => {
    const index = start + relativeIndex
    const status = doctorStatus(check.status)
    const marker = index === normalized.selected ? '›' : index === normalized.hovered ? '»' : ' '
    return `${marker} ${status.glyph} ${sanitize(check.summary ?? 'Unnamed check')}`
  }), wide ? Math.max(38, Math.floor(width * 0.46) - 4) : Math.max(1, width - 4), {
    offset: start,
    total: checks.length,
    hoveredRow: hoveredRailRow,
  })
  const selected = checks[normalized.selected]!
  const status = doctorStatus(selected.status)
  const detailRows = doctorDetailRows(selected, status.kind, wide ? 40 : Math.max(20, width - 4))

  if (wide) {
    const gap = 3
    const listWidth = Math.max(42, Math.floor(width * 0.46))
    const detailWidth = Math.max(24, width - listWidth - gap)
    const bodyHeight = Math.max(listRows.length, detailRows.length)
    const left = renderSupervisorPanel(
      'Doctor checks',
      `${start + 1}–${end}/${checks.length} · ${doctorCompactMeta(report)}`,
      padRows(listRows, bodyHeight),
      listWidth,
    )
    const right = renderSupervisorPanel(
      'Inspection',
      `${normalized.selected + 1}/${checks.length} · ${status.label}`,
      padRows(detailRows, bodyHeight),
      detailWidth,
    )
    return {
      lines: left.map((line, index) => joinColumns(
        line,
        right[index] ?? '',
        listWidth,
        gap,
        width,
      )),
      targets: checks.slice(start, end).map((_, relativeIndex) => ({
        row: relativeIndex + 2,
        startColumn: 2,
        endColumn: listWidth - 1,
        index: start + relativeIndex,
      })),
      railTargets: railVisible
        ? doctorRailTargets(railViewportRows, checks.length, 2, listWidth - 2)
        : [],
    }
  }

  const list = renderSupervisorPanel(
    'Doctor',
    `${start + 1}–${end}/${checks.length} · ${width < 60 ? doctorCompactMeta(report) : doctorMeta(report)}`,
    listRows,
    width,
  )
  const detail = renderSupervisorPanel(
    'Inspection',
    `${normalized.selected + 1}/${checks.length} · ${status.label}`,
    detailRows,
    width,
  )
  return {
    lines: [...list, '', ...detail],
    targets: checks.slice(start, end).map((_, relativeIndex) => ({
      row: relativeIndex + 2,
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
      index: start + relativeIndex,
    })),
    railTargets: railVisible
      ? doctorRailTargets(railViewportRows, checks.length, 2, width - 2)
      : [],
  }
}

function renderEmergencyDoctor(
  report: SupervisorDoctorReport,
  state: SupervisorDoctorState,
  width: number,
): SupervisorDoctorRender {
  const checks = report.checks ?? []
  const selected = checks[state.selected]!
  const status = doctorStatus(selected.status)
  const guidance = status.kind === 'pass'
    ? 'NEXT  No action needed.'
    : status.kind === 'warn'
      ? 'NEXT  Review before changing Runtime.'
      : status.kind === 'fail'
        ? 'FIX   Resolve this condition, then rerun.'
        : 'NEXT  Review this check before acting.'
  return {
    lines: renderSupervisorPanel(
      'Doctor',
      `${doctorCompactMeta(report)} · ${state.selected + 1}/${checks.length}`,
      [
        `${status.glyph} ${status.label} · ${sanitize(selected.summary ?? 'Unnamed check')}`,
        `WHY   ${sanitize(selected.detail ?? 'No additional evidence was reported.')}`,
        guidance,
        `CHECK ${state.selected + 1}/${checks.length} · ↑↓ chooses`,
        '◆ [ d ] Rerun Runtime Doctor',
      ],
      width,
    ),
    targets: [{
      row: 2,
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
      index: state.selected,
    }],
    railTargets: [],
  }
}

function doctorRailTargets(
  viewportRows: number,
  total: number,
  firstRow: number,
  column: number,
): SupervisorScrollRailTarget[] {
  return Array.from({ length: viewportRows }, (_, trackRow) => ({
    row: firstRow + trackRow,
    column,
    trackRow,
    index: supervisorScrollRailIndexAt(trackRow, viewportRows, total) ?? 0,
  }))
}

function doctorDetailRows(
  check: SupervisorDoctorCheck,
  kind: DoctorStatus['kind'],
  width: number,
): string[] {
  const summary = sanitize(check.summary ?? 'Unnamed check')
  const detail = sanitize(check.detail ?? 'No additional evidence was reported.')
  const detailLines = wrapDisplayText(detail, Math.max(1, width)).slice(0, 2)
  const guidance = kind === 'pass'
    ? '✓ No action needed.'
    : kind === 'warn'
      ? '! Review this evidence before changing Runtime state.'
      : kind === 'fail'
        ? '× Resolve this condition, then rerun Doctor.'
        : '· Review this check before acting.'
  return [
    summary,
    ...detailLines,
    guidance,
    '',
    '◆ [ d ] Rerun Runtime Doctor',
  ]
}

interface DoctorStatus {
  kind: 'pass' | 'warn' | 'fail' | 'unknown'
  glyph: '✓' | '!' | '×' | '·'
  label: string
}

function doctorStatus(value: string | undefined): DoctorStatus {
  const status = value?.toLowerCase() ?? 'unknown'
  if (status === 'pass' || status === 'passed') return { kind: 'pass', glyph: '✓', label: 'PASS' }
  if (status === 'warn' || status === 'warning') return { kind: 'warn', glyph: '!', label: 'WARNING' }
  if (status === 'fail' || status === 'failed') return { kind: 'fail', glyph: '×', label: 'FAIL' }
  return { kind: 'unknown', glyph: '·', label: 'UNKNOWN' }
}

function doctorMeta(report: SupervisorDoctorReport): string {
  const summary = report.summary
  return [
    (report.overall ?? 'unknown').toUpperCase(),
    `${summary?.passed ?? 0} pass`,
    `${summary?.warnings ?? 0} warn`,
    `${summary?.failures ?? 0} fail`,
  ].join(' · ')
}

function doctorCompactMeta(report: SupervisorDoctorReport): string {
  const summary = report.summary
  return `${summary?.failures ?? 0}F/${summary?.warnings ?? 0}W/${summary?.passed ?? 0}P`
}

function windowStart(selected: number, total: number, visible: number): number {
  const centered = selected - Math.floor(visible / 2)
  return clamp(centered, 0, Math.max(0, total - visible))
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

function wrapDisplayText(value: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (displayWidth(candidate) <= width) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = truncateDisplayWidth(word, width)
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}

function sanitize(value: string): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
