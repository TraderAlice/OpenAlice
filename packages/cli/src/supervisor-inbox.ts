import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import { renderSupervisorPanel, renderSupervisorSignalScope } from './supervisor-tui-view.ts'

export interface SupervisorInboxDoc {
  path: string
  revision?: string
}

export interface SupervisorInboxOrigin {
  kind: 'headless' | 'interactive' | 'manual'
  runId?: string
  issueId?: string
  issueWorkspaceId?: string
  sessionId?: string
  resumeId?: string
  agent?: string
}

export interface SupervisorInboxEntry {
  id: string
  ts: number
  readAt?: number
  workspaceId: string
  workspaceLabel?: string
  docs?: SupervisorInboxDoc[]
  comments?: string
  origin?: SupervisorInboxOrigin
}

export interface SupervisorInboxSnapshot {
  entries: SupervisorInboxEntry[]
  hasMore: boolean
  endpoint: string
  refreshedAt: number
}

export interface SupervisorInboxState {
  selected: number
  hovered: number | null
}

export interface SupervisorInboxTarget {
  row: number
  startColumn: number
  endColumn: number
  index: number
}

export interface SupervisorInboxRender {
  lines: string[]
  targets: SupervisorInboxTarget[]
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

const HISTORY_LIMIT = 50

export async function readSupervisorInbox(
  endpoint: string,
  fetchImpl: FetchLike = fetch,
): Promise<SupervisorInboxSnapshot> {
  const base = normalizeEndpoint(endpoint)
  const response = await fetchImpl(new URL(`/api/inbox/history?limit=${HISTORY_LIMIT}`, base))
  if (!response.ok) throw new Error(inboxHttpError('load', response.status))
  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.entries)) {
    throw new Error('Inbox returned an invalid history response.')
  }
  return {
    entries: body.entries.map(parseEntry),
    hasMore: body.hasMore === true,
    endpoint: base,
    refreshedAt: Date.now(),
  }
}

export async function setSupervisorInboxRead(
  endpoint: string,
  id: string,
  read: boolean,
  fetchImpl: FetchLike = fetch,
): Promise<number | undefined> {
  const response = await fetchImpl(
    new URL(`/api/inbox/${encodeURIComponent(id)}/read`, normalizeEndpoint(endpoint)),
    { method: read ? 'PUT' : 'DELETE' },
  )
  if (!response.ok) throw new Error(inboxHttpError(read ? 'mark read' : 'mark unread', response.status))
  if (!read) return undefined
  const body: unknown = await response.json()
  if (!isRecord(body) || !finiteNumber(body.readAt)) {
    throw new Error('Inbox returned an invalid read-state response.')
  }
  return body.readAt
}

export function createSupervisorInboxState(): SupervisorInboxState {
  return { selected: 0, hovered: null }
}

export function normalizeSupervisorInboxState(
  state: SupervisorInboxState,
  snapshot?: SupervisorInboxSnapshot | null,
): SupervisorInboxState {
  const count = snapshot?.entries.length ?? 0
  return {
    selected: count === 0 ? 0 : clamp(state.selected, 0, count - 1),
    hovered: state.hovered === null || count === 0 ? null : clamp(state.hovered, 0, count - 1),
  }
}

export function moveSupervisorInboxSelection(
  state: SupervisorInboxState,
  delta: number,
  snapshot?: SupervisorInboxSnapshot | null,
): SupervisorInboxState {
  const count = snapshot?.entries.length ?? 0
  if (count === 0) return { selected: 0, hovered: null }
  return {
    selected: (state.selected + delta % count + count) % count,
    hovered: null,
  }
}

export function supervisorInboxUnreadCount(snapshot?: SupervisorInboxSnapshot | null): number {
  return snapshot?.entries.reduce((count, entry) => count + (entry.readAt ? 0 : 1), 0) ?? 0
}

export function selectedSupervisorInboxEntry(
  snapshot: SupervisorInboxSnapshot | null | undefined,
  state: SupervisorInboxState,
): SupervisorInboxEntry | null {
  if (!snapshot?.entries.length) return null
  return snapshot.entries[normalizeSupervisorInboxState(state, snapshot).selected] ?? null
}

export function supervisorInboxWorkspaceUrl(endpoint: string, workspaceId: string): string {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Inbox Workspace URL must use HTTP or HTTPS.')
  }
  url.pathname = `/workspaces/${encodeURIComponent(workspaceId)}`
  return url.toString()
}

export function updateSupervisorInboxEntryRead(
  snapshot: SupervisorInboxSnapshot,
  id: string,
  readAt: number | undefined,
): SupervisorInboxSnapshot {
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => entry.id === id
      ? { ...entry, readAt }
      : entry),
  }
}

export function renderSupervisorInbox(
  snapshot: SupervisorInboxSnapshot | null | undefined,
  state: SupervisorInboxState,
  width: number,
  targetHeight?: number,
): SupervisorInboxRender {
  if (!snapshot) {
    return {
      lines: renderSupervisorSignalScope({
        title: 'Inbox Relay',
        glyph: '◇',
        state: 'AWAITING TARGET',
        meta: 'DISCONNECTED',
        facts: [
          { label: 'Source', value: 'Active AliceProject HTTP endpoint' },
          { label: 'State', value: 'Shared read/unread attention state' },
          { label: 'Safety', value: 'Read and mark only · no delete', compactValue: 'No destructive actions' },
        ],
        action: { key: 'c', label: 'Choose a connection', compactLabel: 'Connect' },
      }, width, targetHeight),
      targets: [],
    }
  }
  if (snapshot.entries.length === 0) {
    return {
      lines: renderSupervisorSignalScope({
        title: 'Inbox Relay',
        glyph: '✓',
        state: 'ALL CLEAR',
        meta: '0 MESSAGES',
        facts: [
          { label: 'Target', value: endpointLabel(snapshot.endpoint) },
          { label: 'History', value: 'No delivered agent messages' },
          { label: 'Refresh', value: formatTimestamp(snapshot.refreshedAt) },
        ],
        action: { key: 'r', label: 'Reload Inbox', compactLabel: 'Reload' },
      }, width, targetHeight),
      targets: [],
    }
  }

  const normalized = normalizeSupervisorInboxState(state, snapshot)
  const entries = snapshot.entries
  const wide = width >= 100
  const visible = wide && Number.isFinite(targetHeight)
    ? Math.min(20, Math.max(7, Math.floor(targetHeight ?? 0) - 4))
    : width < 60 ? 4 : 7
  const start = windowStart(normalized.selected, entries.length, visible)
  const end = Math.min(entries.length, start + visible)
  const listRows = entries.slice(start, end).map((entry, offset) => {
    const index = start + offset
    const marker = index === normalized.selected ? '›' : index === normalized.hovered ? '»' : ' '
    const attention = entry.readAt ? '○' : '●'
    return `${marker} ${attention} ${streamSourceLabel(entry)}  ·  ${entryTitle(entry)}  ·  ${relativeTime(entry.ts)}`
  })
  const selected = entries[normalized.selected]!
  const unread = supervisorInboxUnreadCount(snapshot)
  const meta = `${unread} UNREAD · ${start + 1}–${end}/${entries.length}${snapshot.hasMore ? ' · MORE' : ''}`

  if (wide) {
    const innerWidth = width - 4
    const gutter = '    '
    const listWidth = Math.max(40, Math.floor(innerWidth * 0.42))
    const detailWidth = Math.max(24, innerWidth - listWidth - displayWidth(gutter))
    const stream = [`MESSAGE STREAM · ${start + 1}–${end}/${entries.length}`, ...listRows]
    const details = [
      `SELECTED · ${selected.readAt ? 'READ' : 'UNREAD'} · ${formatTimestamp(selected.ts)}`,
      '',
      ...inboxDetailRows(selected, detailWidth),
    ]
    const naturalBodyHeight = Math.max(stream.length, details.length)
    const requestedBodyHeight = Number.isFinite(targetHeight)
      ? Math.max(naturalBodyHeight, Math.floor(targetHeight ?? 0) - 2)
      : naturalBodyHeight
    const bodyHeight = Math.min(21, requestedBodyHeight)
    const left = padRows(stream, bodyHeight)
    const right = padRows(details, bodyHeight)
    const body = Array.from({ length: bodyHeight }, (_, index) => (
      `${fillRow(left[index] ?? '', listWidth)}${gutter}${truncateDisplayWidth(right[index] ?? '', detailWidth)}`
    ))
    return {
      lines: renderSupervisorPanel('Inbox Desk', meta, body, width),
      targets: entries.slice(start, end).map((_, offset) => ({
        row: offset + 3,
        startColumn: 2,
        endColumn: listWidth + 1,
        index: start + offset,
      })),
    }
  }

  const body = [
    `MESSAGE STREAM · ${start + 1}–${end}/${entries.length}`,
    ...listRows,
    '',
    `SELECTED · ${selected.readAt ? 'READ' : 'UNREAD'} · ${workspaceLabel(selected)}`,
    ...inboxDetailRows(selected, Math.max(20, width - 4)),
  ]
  return {
    lines: renderSupervisorPanel('Inbox Desk', meta, body, width),
    targets: entries.slice(start, end).map((_, offset) => ({
      row: offset + 3,
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
      index: start + offset,
    })),
  }
}

function parseEntry(value: unknown, index: number): SupervisorInboxEntry {
  if (!isRecord(value)
    || !nonEmptyString(value.id)
    || !finiteNumber(value.ts)
    || !nonEmptyString(value.workspaceId)) {
    throw new Error(`Inbox entry ${index + 1} is invalid.`)
  }
  return {
    id: safe(value.id),
    ts: value.ts,
    ...(finiteNumber(value.readAt) ? { readAt: value.readAt } : {}),
    workspaceId: safe(value.workspaceId),
    ...(nonEmptyString(value.workspaceLabel) ? { workspaceLabel: safe(value.workspaceLabel) } : {}),
    ...(Array.isArray(value.docs) ? { docs: value.docs.map(parseDoc).filter(Boolean) as SupervisorInboxDoc[] } : {}),
    ...(typeof value.comments === 'string' ? { comments: safe(value.comments) } : {}),
    ...(isRecord(value.origin) ? { origin: parseOrigin(value.origin) } : {}),
  }
}

function parseDoc(value: unknown): SupervisorInboxDoc | null {
  if (!isRecord(value) || !nonEmptyString(value.path)) return null
  return {
    path: safe(value.path),
    ...(nonEmptyString(value.revision) ? { revision: safe(value.revision) } : {}),
  }
}

function parseOrigin(value: Record<string, unknown>): SupervisorInboxOrigin {
  const kind = value.kind === 'headless' || value.kind === 'interactive' || value.kind === 'manual'
    ? value.kind
    : 'manual'
  const optional = (key: keyof Omit<SupervisorInboxOrigin, 'kind'>) => (
    nonEmptyString(value[key]) ? { [key]: safe(value[key]) } : {}
  )
  return {
    kind,
    ...optional('runId'),
    ...optional('issueId'),
    ...optional('issueWorkspaceId'),
    ...optional('sessionId'),
    ...optional('resumeId'),
    ...optional('agent'),
  }
}

function inboxDetailRows(entry: SupervisorInboxEntry, width: number): string[] {
  const rows = [
    `◆ ${entryTitle(entry)}`,
    `Workspace  ${workspaceLabel(entry)}`,
  ]
  if (entry.origin) {
    const identity = entry.origin.agent ?? entry.origin.kind
    const provenance = entry.origin.issueId ?? entry.origin.resumeId ?? entry.origin.runId ?? entry.origin.sessionId
    rows.push(`From       ${identity}${provenance ? ` · ${provenance}` : ''}`)
  }
  rows.push('')
  if (entry.comments?.trim()) rows.push(...wrapText(entry.comments, width, 8))
  const docs = entry.docs ?? []
  if (docs.length > 0) {
    if (entry.comments?.trim()) rows.push('')
    rows.push(`Documents  ${docs.length}`)
    rows.push(...docs.slice(0, 5).map((doc) => `◇ ${doc.path}`))
    if (docs.length > 5) rows.push(`… ${docs.length - 5} more`)
  }
  if (rows.at(-1) !== '') rows.push('')
  rows.push(`◆ [ o ] Open Workspace  │  [ Enter ] ${entry.readAt ? 'Mark unread' : 'Mark read'}`)
  return rows.map((row) => truncateDisplayWidth(row, width))
}

function entryTitle(entry: SupervisorInboxEntry): string {
  const first = entry.comments?.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean)
  return safe(first ?? entry.docs?.[0]?.path ?? 'Inbox update')
}

function workspaceLabel(entry: SupervisorInboxEntry): string {
  return safe(entry.workspaceLabel ?? entry.workspaceId)
}

function streamSourceLabel(entry: SupervisorInboxEntry): string {
  const workspace = workspaceLabel(entry)
  const agent = entry.origin?.agent ? safe(entry.origin.agent) : ''
  return agent ? `${workspace} / ${agent}` : workspace
}

function wrapText(value: string, width: number, limit: number): string[] {
  const words = safe(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const rows: string[] = []
  let row = ''
  for (const word of words) {
    const next = row ? `${row} ${word}` : word
    if (displayWidth(next) <= width) row = next
    else {
      if (row) rows.push(row)
      row = truncateDisplayWidth(word, width)
      if (rows.length >= limit) break
    }
  }
  if (row && rows.length < limit) rows.push(row)
  if (words.length > 0 && rows.length === limit) rows[limit - 1] = truncateDisplayWidth(`${rows[limit - 1]}…`, width)
  return rows
}

function normalizeEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Inbox endpoint must use HTTP or HTTPS.')
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function inboxHttpError(action: string, status: number): string {
  if (status === 401 || status === 403) return `Inbox could not ${action}: authenticate this target in the Web UI.`
  return `Inbox could not ${action}: HTTP ${status}.`
}

function endpointLabel(endpoint: string): string {
  try { return new URL(endpoint).host }
  catch { return endpoint }
}

function formatTimestamp(value: number): string {
  return new Date(value).toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, 'Z')
}

function relativeTime(value: number): string {
  const delta = Math.max(0, Date.now() - value)
  if (delta < 60_000) return 'now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`
  return `${Math.floor(delta / 86_400_000)}d`
}

function padRows(rows: string[], height: number): string[] {
  return [...rows, ...Array.from({ length: Math.max(0, height - rows.length) }, () => '')]
}

function fillRow(value: string, width: number): string {
  const safe = truncateDisplayWidth(value, width)
  return `${safe}${' '.repeat(Math.max(0, width - displayWidth(safe)))}`
}

function windowStart(selected: number, count: number, visible: number): number {
  return clamp(selected - Math.floor(visible / 2), 0, Math.max(0, count - visible))
}

function safe(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u001b]/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
