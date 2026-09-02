import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import { withSupervisorScrollRail } from './supervisor-scroll-rail.ts'
import { renderSupervisorPanel, renderSupervisorSignalScope } from './supervisor-tui-view.ts'

export type SupervisorLogFilter = 'all' | 'attention' | 'errors'

export interface SupervisorRuntimeLogs {
  entries?: Array<{ text?: string }>
  truncated?: boolean
}

export interface SupervisorLogTarget {
  /** 1-based row inside the complete Event Lens rendering. */
  row: number
  startColumn: number
  endColumn: number
  fromEnd: number
}

export interface SupervisorLogRender {
  lines: string[]
  targets: SupervisorLogTarget[]
}

interface FormattedLogEntry {
  glyph: '·' | '!' | '×'
  severity: 'INFO' | 'WARNING' | 'ERROR'
  format: 'JSON' | 'TEXT'
  text: string
  raw: string
}

interface IndexedLogEntry extends FormattedLogEntry {
  number: number
}

const projectionCache = new WeakMap<SupervisorRuntimeLogs, IndexedLogEntry[]>()

export function nextSupervisorLogFilter(
  filter: SupervisorLogFilter,
): SupervisorLogFilter {
  if (filter === 'all') return 'attention'
  if (filter === 'attention') return 'errors'
  return 'all'
}

export function supervisorLogFilterLabel(filter: SupervisorLogFilter): string {
  if (filter === 'attention') return 'alerts'
  if (filter === 'errors') return 'errors'
  return 'all'
}

export function supervisorFilteredLogCount(
  logs: SupervisorRuntimeLogs | null | undefined,
  filter: SupervisorLogFilter,
): number {
  return filterLogEntries(logs, filter).length
}

export function renderSupervisorLogs(
  logs: SupervisorRuntimeLogs | null | undefined,
  width: number,
  fromEnd: number,
  filter: SupervisorLogFilter,
  hoveredFromEnd: number | null = null,
): SupervisorLogRender {
  if (!logs) {
    return {
      lines: renderSupervisorSignalScope({
        title: 'Event Signal Scope',
        glyph: '◇',
        state: 'SIGNAL STANDBY',
        meta: 'STANDBY',
        facts: [
          { label: 'Snapshot', value: 'Not loaded' },
          { label: 'Lens', value: `${logLensDescription(filter)} · awaiting capture` },
          { label: 'Safety', value: 'Bounded · redacted · terminal-safe', compactValue: 'bounded · redacted' },
        ],
        action: { key: 'l', label: 'Load bounded Runtime tail', compactLabel: 'Load Runtime tail' },
      }, width),
      targets: [],
    }
  }
  const sourceEntries = logs.entries ?? []
  if (sourceEntries.length === 0) {
    return {
      lines: renderSupervisorSignalScope({
        title: 'Event Signal Scope',
        glyph: '○',
        state: 'SIGNAL QUIET',
        meta: 'QUIET · 0 EVENTS',
        facts: [
          { label: 'Snapshot', value: 'Loaded · 0 Runtime events' },
          { label: 'Lens', value: `${logLensDescription(filter)} · source is quiet` },
          { label: 'Safety', value: 'Bounded · redacted · terminal-safe', compactValue: 'bounded · redacted' },
        ],
        action: { key: 'l', label: 'Reload Runtime snapshot', compactLabel: 'Reload snapshot' },
      }, width),
      targets: [],
    }
  }
  const entries = filterLogEntries(logs, filter)
  if (entries.length === 0) {
    return {
      lines: renderSupervisorSignalScope({
        title: 'Event Signal Scope',
        glyph: '✓',
        state: 'LENS CLEAR',
        meta: `CLEAR · 0/${sourceEntries.length} · ${filter.toUpperCase()}`,
        facts: [
          {
            label: 'Snapshot',
            value: `Loaded · ${sourceEntries.length} Runtime ${pluralize(sourceEntries.length, 'event')}`,
          },
          { label: 'Lens', value: `${supervisorLogFilterLabel(filter)} · 0 matches` },
          { label: 'Safety', value: 'Bounded · redacted · terminal-safe', compactValue: 'bounded · redacted' },
        ],
        action: { key: 'f', label: 'Change severity lens', compactLabel: 'Change lens' },
      }, width),
      targets: [],
    }
  }

  const safeFromEnd = clamp(fromEnd, 0, entries.length - 1)
  const selectedIndex = entries.length - 1 - safeFromEnd
  const selected = entries[selectedIndex]!
  const wide = width >= 100
  const visible = wide ? 10 : width < 60 ? 4 : 7
  const start = windowStart(selectedIndex, entries.length, visible)
  const end = Math.min(entries.length, start + visible)
  const numberWidth = String(sourceEntries.length).length
  const omitted = Boolean(logs.truncated && start === 0)
  let listRows = entries.slice(start, end).map((entry, relativeIndex) => {
    const index = start + relativeIndex
    const rowFromEnd = entries.length - 1 - index
    const marker = index === selectedIndex ? '›' : rowFromEnd === hoveredFromEnd ? '»' : ' '
    return `${marker} ${entry.glyph} ${String(entry.number).padStart(numberWidth, ' ')}  ${entry.text}`.trimEnd()
  })
  if (omitted) listRows.unshift('· … earlier lines were omitted by the bounded reader')
  listRows = withSupervisorScrollRail(listRows, wide
    ? Math.max(44, Math.floor(width * 0.54) - 4)
    : Math.max(1, width - 4), {
    offset: omitted ? 0 : start + (logs.truncated ? 1 : 0),
    total: entries.length + (logs.truncated ? 1 : 0),
  })

  const filterMeta = filter === 'all'
    ? 'ALL'
    : `${filter.toUpperCase()} · ${entries.length}/${sourceEntries.length}`
  const position = `${start + 1}–${end}/${entries.length} · ${filterMeta}${safeFromEnd === 0 ? ' · LATEST' : ''}`
  const detailRows = eventDetailRows(
    selected,
    wide ? Math.max(24, Math.floor(width * 0.46) - 4) : Math.max(20, width - 4),
  )

  if (wide) {
    const gap = 3
    const listWidth = Math.max(48, Math.floor(width * 0.54))
    const detailWidth = Math.max(24, width - listWidth - gap)
    const bodyHeight = Math.max(listRows.length, detailRows.length)
    const left = renderSupervisorPanel(
      'Event stream',
      position,
      padRows(listRows, bodyHeight),
      listWidth,
    )
    const right = renderSupervisorPanel(
      'Event Lens',
      `LINE ${selected.number} · ${selected.severity} · ${selected.format}`,
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
      targets: entries.slice(start, end).map((_, relativeIndex) => ({
        row: relativeIndex + 2 + (omitted ? 1 : 0),
        startColumn: 2,
        endColumn: listWidth - 1,
        fromEnd: entries.length - 1 - (start + relativeIndex),
      })),
    }
  }

  const list = renderSupervisorPanel('Event stream', position, listRows, width)
  const detail = renderSupervisorPanel(
    'Event Lens',
    `LINE ${selected.number} · ${selected.severity} · ${selected.format}`,
    detailRows,
    width,
  )
  return {
    lines: [...list, '', ...detail],
    targets: entries.slice(start, end).map((_, relativeIndex) => ({
      row: relativeIndex + 2 + (omitted ? 1 : 0),
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
      fromEnd: entries.length - 1 - (start + relativeIndex),
    })),
  }
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`
}

function logLensDescription(filter: SupervisorLogFilter): string {
  if (filter === 'attention') return 'warnings + errors'
  if (filter === 'errors') return 'errors only'
  return 'all events'
}

function filterLogEntries(
  logs: SupervisorRuntimeLogs | null | undefined,
  filter: SupervisorLogFilter,
): IndexedLogEntry[] {
  if (!logs) return []
  let projected = projectionCache.get(logs)
  if (!projected) {
    projected = (logs.entries ?? []).map((entry, index) => ({
      number: index + 1,
      ...formatRuntimeLogEntry(entry.text ?? ''),
    }))
    projectionCache.set(logs, projected)
  }
  return projected.filter((entry) => (
    filter === 'all'
    || (filter === 'attention' && (entry.glyph === '!' || entry.glyph === '×'))
    || (filter === 'errors' && entry.glyph === '×')
  ))
}

function formatRuntimeLogEntry(value: string): FormattedLogEntry {
  const trimmed = value.trim()
  if (!trimmed) return { glyph: '·', severity: 'INFO', format: 'TEXT', text: '', raw: '' }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const level = typeof record['level'] === 'string' ? record['level'].toLowerCase() : 'info'
      const message = typeof record['msg'] === 'string'
        ? sanitize(record['msg'])
        : 'Structured Runtime event'
      const time = formatRuntimeLogTime(record['ts'])
      const context = Object.entries(record)
        .filter(([key]) => key !== 'ts' && key !== 'level' && key !== 'msg')
        .slice(0, 3)
        .map(([key, field]) => `${sanitize(key)}=${formatRuntimeLogField(field)}`)
        .join(' ')
      const glyph = logLevelGlyph(level)
      return {
        glyph,
        severity: logSeverity(glyph),
        format: 'JSON',
        text: [time, message, context ? `· ${context}` : ''].filter(Boolean).join(' '),
        raw: sanitize(trimmed),
      }
    }
  } catch {
    // Third-party and legacy logs remain valid plain-text entries.
  }
  const safe = sanitize(value)
  const severity = /\b(error|fatal|failed|failure)\b/iu.test(safe)
    ? 'error'
    : /\b(warn|warning)\b/iu.test(safe) ? 'warn' : 'info'
  const glyph = logLevelGlyph(severity)
  return { glyph, severity: logSeverity(glyph), format: 'TEXT', text: safe, raw: safe }
}

function eventDetailRows(entry: IndexedLogEntry, width: number): string[] {
  const contentWidth = Math.max(1, width)
  const summary = wrapDisplayText(entry.text || 'Empty log entry.', contentWidth).slice(0, 2)
  const raw = wrapDisplayText(`Raw · ${entry.raw || '(empty)'}`, contentWidth).slice(0, 2)
  return [...summary, ...raw]
}

function formatRuntimeLogTime(value: unknown): string {
  if (typeof value !== 'string') return ''
  const utc = /T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/u.exec(value)
  if (utc?.[1]) return `${utc[1]}Z`
  const clock = /T(\d{2}:\d{2}:\d{2})/u.exec(value)
  return clock?.[1] ?? sanitize(value)
}

function formatRuntimeLogField(value: unknown): string {
  if (typeof value === 'string') return sanitize(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  try {
    return sanitize(JSON.stringify(value))
  } catch {
    return '[unavailable]'
  }
}

function logLevelGlyph(level: string): FormattedLogEntry['glyph'] {
  if (level === 'fatal' || level === 'error') return '×'
  if (level === 'warn' || level === 'warning') return '!'
  return '·'
}

function logSeverity(glyph: FormattedLogEntry['glyph']): FormattedLogEntry['severity'] {
  if (glyph === '×') return 'ERROR'
  if (glyph === '!') return 'WARNING'
  return 'INFO'
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
