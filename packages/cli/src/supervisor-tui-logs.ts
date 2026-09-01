import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export type SupervisorLogFilter = 'all' | 'attention' | 'errors'

export interface SupervisorRuntimeLogs {
  entries?: Array<{ text?: string }>
  truncated?: boolean
}

interface FormattedLogEntry {
  glyph: '·' | '!' | '×'
  text: string
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
): string[] {
  if (!logs) return ['Press l to load the bounded, redacted Runtime log tail.']
  const sourceEntries = logs.entries ?? []
  if (sourceEntries.length === 0) return ['No Runtime log entries were found.']
  const entries = filterLogEntries(logs, filter)
  if (entries.length === 0) {
    return renderSupervisorPanel('Runtime Logs', `0/${sourceEntries.length} · ${filter.toUpperCase()}`, [
      filter === 'errors'
        ? '✓ No error log entries in this snapshot.'
        : '✓ No warning or error log entries in this snapshot.',
      'Press f to return to another severity view.',
    ], width)
  }

  const visible = 12
  const safeFromEnd = clamp(fromEnd, 0, Math.max(0, entries.length - 1))
  const end = Math.max(1, entries.length - safeFromEnd)
  const start = Math.max(0, end - visible)
  const filterMeta = filter === 'all'
    ? ''
    : ` · ${filter.toUpperCase()} · ${entries.length}/${sourceEntries.length}`
  const position = `${start + 1}–${end}/${entries.length}${filterMeta}${safeFromEnd === 0 ? ' · LATEST' : ''}`
  const numberWidth = String(sourceEntries.length).length
  const rows = entries.slice(start, end).map((entry) => (
    `${entry.glyph} ${String(entry.number).padStart(numberWidth, ' ')}  ${entry.text}`.trimEnd()
  ))
  if (logs.truncated && start === 0) rows.unshift('· … earlier lines were omitted by the bounded reader')
  return renderSupervisorPanel('Runtime Logs', position, rows, width)
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
  if (!trimmed) return { glyph: '·', text: '' }
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
      return {
        glyph: logLevelGlyph(level),
        text: [time, message, context ? `· ${context}` : ''].filter(Boolean).join(' '),
      }
    }
  } catch {
    // Third-party and legacy logs remain valid plain-text entries.
  }
  const safe = sanitize(value)
  const severity = /\b(error|fatal|failed|failure)\b/iu.test(safe)
    ? 'error'
    : /\b(warn|warning)\b/iu.test(safe) ? 'warn' : 'info'
  return { glyph: logLevelGlyph(severity), text: safe }
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

function sanitize(value: string): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
