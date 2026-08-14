import { TELEGRAM_PLAIN_TEXT_MAX } from '@traderalice/connector-protocol'
import type { InboxEntry } from '@/core/inbox-store.js'

export const TELEGRAM_INBOX_PAGE_SIZE = 5
export const TELEGRAM_INBOX_FILE_PAGE_SIZE = 5
export const TELEGRAM_INBOX_PAGE_HARD_MAX = 3200
export const TELEGRAM_CALLBACK_DATA_MAX = 64
export const TELEGRAM_BUTTON_TEXT_MAX = 64
export const TELEGRAM_INBOX_TITLE_MAX = 48
export const TELEGRAM_INBOX_WORKSPACE_MAX = 28
export const TELEGRAM_INBOX_BODY_MAX = 72
export const TELEGRAM_INBOX_DETAIL_BODY_MAX = 1800
export const TELEGRAM_INBOX_FILENAME_MAX = 40

export type TelegramInboxScope = 'unread' | 'all'

export type TelegramControl =
  | { kind: 'inbox'; direction: 'older' | 'newer' }
  | { kind: 'inbox-scope'; scope: TelegramInboxScope }
  | { kind: 'inbox-entry'; entryIndex: number }
  | { kind: 'inbox-back' }
  | { kind: 'settings'; inboxPush: boolean }
  | { kind: 'inbox-files'; entryIndex: number }
  | { kind: 'inbox-open-files' }
  | { kind: 'inbox-files-page'; page: number }
  | { kind: 'inbox-doc'; docIndex: number }
  | { kind: 'inbox-send' }
  | { kind: 'inbox-cancel' }

export interface TelegramFormAction {
  text: string
  data: string
}

export interface TelegramForm {
  text: string
  actions: TelegramFormAction[][]
}

export interface TelegramInboxSession {
  stack: string[]
  scope?: TelegramInboxScope
  before?: string
  entryIds?: string[]
  view?:
    | { kind: 'detail'; entryId: string }
    | { kind: 'files'; entryId: string; page: number }
    | { kind: 'confirm'; entryId: string; docIndex: number; filePage: number }
    | { kind: 'requesting'; entryId: string; docIndex: number }
}

export type TelegramInboxResolution =
  | { kind: 'forbidden' }
  | { kind: 'ignored' }
  | { kind: 'settings'; inboxPush: boolean }
  | { kind: 'expired' }
  | { kind: 'page'; direction: 'older' | 'newer'; session: TelegramInboxSession }
  | { kind: 'reload-inbox'; session: TelegramInboxSession }
  | { kind: 'show'; form: TelegramForm; session: TelegramInboxSession }
  | {
      kind: 'request-artifact'
      entryId: string
      docIndex: number
      form: TelegramForm
      session: TelegramInboxSession
    }
  | { kind: 'error'; text: string; session?: TelegramInboxSession }

const FILES_CONTROL = /^i:f:([0-4])$/
const ENTRY_CONTROL = /^i:e:([0-4])$/
const FILE_PAGE_CONTROL = /^i:fp:(\d{1,3})$/
const DOC_CONTROL = /^i:d:(\d{1,3})$/

export function parseTelegramControl(data: string): TelegramControl | undefined {
  if (data.length === 0 || data.length > TELEGRAM_CALLBACK_DATA_MAX) return undefined
  if (data === 'i:o') return { kind: 'inbox', direction: 'older' }
  if (data === 'i:n') return { kind: 'inbox', direction: 'newer' }
  if (data === 'i:s:u') return { kind: 'inbox-scope', scope: 'unread' }
  if (data === 'i:s:a') return { kind: 'inbox-scope', scope: 'all' }
  if (data === 'i:b') return { kind: 'inbox-back' }
  if (data === 'i:v') return { kind: 'inbox-open-files' }
  if (data === 'i:y') return { kind: 'inbox-send' }
  if (data === 'i:x') return { kind: 'inbox-cancel' }
  if (data === 's:p:0') return { kind: 'settings', inboxPush: false }
  if (data === 's:p:1') return { kind: 'settings', inboxPush: true }
  const entry = ENTRY_CONTROL.exec(data)
  if (entry) return { kind: 'inbox-entry', entryIndex: Number(entry[1]) }
  const files = FILES_CONTROL.exec(data)
  if (files) return { kind: 'inbox-files', entryIndex: Number(files[1]) }
  const filePage = FILE_PAGE_CONTROL.exec(data)
  if (filePage) return { kind: 'inbox-files-page', page: Number(filePage[1]) }
  const doc = DOC_CONTROL.exec(data)
  if (doc) return { kind: 'inbox-doc', docIndex: Number(doc[1]) }
  return undefined
}

export function truncateTelegramText(value: string, max: number): string {
  if (max <= 0) return ''
  if (value.length <= max) return value
  if (max === 1) return '…'
  let end = max - 1
  if (end > 0 && isHighSurrogate(value.charCodeAt(end - 1))) end -= 1
  if (end <= 0) return '…'
  return `${value.slice(0, end)}…`
}

export function inboxFileDisplayName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const name = (normalized.split('/').at(-1) ?? '').trim()
  return name || 'file'
}

export function inboxEntryTitle(entry: InboxEntry): string {
  const comment = entry.comments?.trim()
  if (comment) {
    return truncateTelegramText(comment.split('\n')[0] ?? comment, TELEGRAM_INBOX_TITLE_MAX)
  }
  const fallback = entry.docs?.[0]?.path
  if (fallback) return truncateTelegramText(inboxFileDisplayName(fallback), TELEGRAM_INBOX_TITLE_MAX)
  return 'Inbox item'
}

export function formatTelegramInboxPage(input: {
  entries: InboxEntry[]
  hasMore: boolean
  canGoNewer: boolean
  scope: TelegramInboxScope
}): TelegramForm {
  const scopeActions = [
    button(input.scope === 'unread' ? '✓ Unread' : 'Unread', 'i:s:u'),
    button(input.scope === 'all' ? '✓ All' : 'All', 'i:s:a'),
  ]
  if (input.entries.length === 0) {
    return {
      text: input.canGoNewer
        ? `No older ${input.scope === 'unread' ? 'unread ' : ''}Inbox items.`
        : input.scope === 'unread'
          ? 'No unread Inbox items. Switch to All for the full history.'
          : 'Inbox is empty.',
      actions: [scopeActions, ...(input.canGoNewer ? [[button('Newer', 'i:n')]] : [])],
    }
  }

  const lines = [`Inbox · ${input.scope}`, '']
  const entryButtons: TelegramFormAction[][] = []
  for (const [index, entry] of input.entries.entries()) {
    const workspace = truncateTelegramText(
      entry.workspaceLabel ?? entry.workspaceId,
      TELEGRAM_INBOX_WORKSPACE_MAX,
    )
    const when = formatInboxWhen(entry.ts)
    const body = collapseWhitespace(entry.comments ?? '')
    const docCount = entry.docs?.length ?? 0
    lines.push(`${index + 1}. ${inboxEntryTitle(entry)}`)
    lines.push(`${workspace} · ${when}`)
    if (body) lines.push(truncateTelegramText(body, TELEGRAM_INBOX_BODY_MAX))
    if (docCount > 0) lines.push(`Files: ${docCount}`)
    lines.push('')
    entryButtons.push([button(`${index + 1} · ${inboxEntryTitle(entry)}`, `i:e:${index}`)])
  }

  const actions: TelegramFormAction[][] = [scopeActions, ...entryButtons]
  const nav: TelegramFormAction[] = []
  if (input.canGoNewer) nav.push(button('Newer', 'i:n'))
  if (input.hasMore) nav.push(button('Older', 'i:o'))
  if (nav.length > 0) actions.push(nav)
  return {
    text: fitPageText(lines.join('\n')),
    actions,
  }
}

export function formatTelegramInboxDetailPage(entry: InboxEntry): TelegramForm {
  const workspace = truncateTelegramText(
    entry.workspaceLabel ?? entry.workspaceId,
    TELEGRAM_INBOX_WORKSPACE_MAX,
  )
  const body = entry.comments?.trim()
  const docCount = entry.docs?.length ?? 0
  const lines = [
    inboxEntryTitle(entry),
    `${workspace} · ${formatInboxWhen(entry.ts)}`,
    '',
    body ? truncateTelegramText(body, TELEGRAM_INBOX_DETAIL_BODY_MAX) : 'No message body.',
    ...(docCount > 0 ? ['', `Files: ${docCount}`] : []),
  ]
  const actions: TelegramFormAction[][] = []
  if (docCount > 0) actions.push([button(`View ${docCount} file${docCount === 1 ? '' : 's'}`, 'i:v')])
  actions.push([button('Back to Inbox', 'i:b')])
  return { text: fitPageText(lines.join('\n')), actions }
}

export function formatTelegramInboxFilesPage(entry: InboxEntry, page: number): TelegramForm {
  const docs = entry.docs ?? []
  if (docs.length === 0) {
    return {
      text: 'This Inbox item has no files.',
      actions: [[button('Back', 'i:b')]],
    }
  }
  const lastPage = Math.max(0, Math.ceil(docs.length / TELEGRAM_INBOX_FILE_PAGE_SIZE) - 1)
  const current = Math.min(Math.max(0, page), lastPage)
  const start = current * TELEGRAM_INBOX_FILE_PAGE_SIZE
  const slice = docs.slice(start, start + TELEGRAM_INBOX_FILE_PAGE_SIZE)
  const lines = [
    `Files · ${inboxEntryTitle(entry)}`,
    '',
    ...slice.map((doc, index) => (
      `${start + index + 1}. ${truncateTelegramText(inboxFileDisplayName(doc.path), TELEGRAM_INBOX_FILENAME_MAX)}`
    )),
  ]
  const fileButtons = slice.map((doc, index) => button(
    truncateTelegramText(inboxFileDisplayName(doc.path), 24),
    `i:d:${start + index}`,
  ))
  const actions = chunk(fileButtons, 2)
  const nav = [button('Back', 'i:b')]
  if (current > 0) nav.unshift(button('Prev', `i:fp:${current - 1}`))
  if (start + slice.length < docs.length) nav.push(button('Next', `i:fp:${current + 1}`))
  actions.push(nav)
  return { text: fitPageText(lines.join('\n')), actions }
}

export function formatTelegramInboxConfirmPage(displayName: string): TelegramForm {
  const safe = truncateTelegramText(displayName, TELEGRAM_INBOX_FILENAME_MAX)
  return {
    text: [
      `Send the current version of ${safe}?`,
      '',
      'OpenAlice will read the live Workspace file now. This does not mark the Inbox item read.',
    ].join('\n'),
    actions: [[button('Send', 'i:y'), button('Cancel', 'i:x')]],
  }
}

export function formatTelegramInboxRequestingPage(displayName: string): TelegramForm {
  const safe = truncateTelegramText(displayName, TELEGRAM_INBOX_FILENAME_MAX)
  return {
    text: `Requesting the current version of ${safe}…`,
    actions: [],
  }
}

export function formatTelegramSettingsPage(inboxPush: boolean): TelegramForm {
  return {
    text: [
      'Telegram settings',
      '',
      `Inbox push: ${inboxPush ? 'On' : 'Off'}`,
      inboxPush
        ? 'New Inbox items arrive in this chat as they land.'
        : 'New Inbox items stay in OpenAlice. Use /inbox when you want to look.',
    ].join('\n'),
    actions: [[
      inboxPush
        ? button('Turn off push', 's:p:0')
        : button('Turn on push', 's:p:1'),
    ]],
  }
}

export function advanceInboxSession(
  session: TelegramInboxSession,
  direction: 'older' | 'newer',
  oldestId?: string,
): TelegramInboxSession {
  if (direction === 'older') {
    if (!oldestId) return session
    return {
      ...session,
      stack: [...session.stack, session.before ?? ''],
      before: oldestId,
    }
  }
  const stack = [...session.stack]
  const before = stack.pop()
  return { ...session, stack, before: before || undefined }
}

export async function transitionTelegramInbox(
  session: TelegramInboxSession | undefined,
  control: TelegramControl,
  deps: {
    isOwner: boolean
    getEntry(id: string): Promise<InboxEntry | null>
  },
): Promise<TelegramInboxResolution> {
  if (!deps.isOwner) return { kind: 'forbidden' }
  if (control.kind === 'settings') return { kind: 'settings', inboxPush: control.inboxPush }
  if (control.kind === 'inbox-scope') {
    if (!session) return { kind: 'expired' }
    return {
      kind: 'reload-inbox',
      session: { stack: [], scope: control.scope, entryIds: [], view: undefined },
    }
  }
  if (control.kind === 'inbox') {
    if (!session) return { kind: 'expired' }
    return { kind: 'page', direction: control.direction, session }
  }
  if (!session) return { kind: 'expired' }

  if (control.kind === 'inbox-back') {
    if (session.view?.kind === 'files' || session.view?.kind === 'confirm') {
      const entry = await deps.getEntry(session.view.entryId)
      if (!entry) return missingEntry(session)
      const next = { ...session, view: { kind: 'detail' as const, entryId: entry.id } }
      return { kind: 'show', form: formatTelegramInboxDetailPage(entry), session: next }
    }
    return { kind: 'reload-inbox', session: { ...session, view: undefined } }
  }

  if (control.kind === 'inbox-entry') {
    const entryId = session.entryIds?.[control.entryIndex]
    if (!entryId) return { kind: 'expired' }
    const entry = await deps.getEntry(entryId)
    if (!entry) return missingEntry(session)
    const next = { ...session, view: { kind: 'detail' as const, entryId } }
    return { kind: 'show', form: formatTelegramInboxDetailPage(entry), session: next }
  }

  if (control.kind === 'inbox-open-files') {
    if (session.view?.kind !== 'detail') return { kind: 'expired' }
    const entry = await deps.getEntry(session.view.entryId)
    if (!entry) return missingEntry(session)
    const next: TelegramInboxSession = {
      ...session,
      view: { kind: 'files', entryId: entry.id, page: 0 },
    }
    return { kind: 'show', form: formatTelegramInboxFilesPage(entry, 0), session: next }
  }

  if (control.kind === 'inbox-files') {
    const entryId = session.entryIds?.[control.entryIndex]
    if (!entryId) return { kind: 'expired' }
    const entry = await deps.getEntry(entryId)
    if (!entry) return missingEntry(session)
    const next: TelegramInboxSession = {
      ...session,
      view: { kind: 'files', entryId, page: 0 },
    }
    return { kind: 'show', form: formatTelegramInboxFilesPage(entry, 0), session: next }
  }

  if (control.kind === 'inbox-files-page') {
    const view = session.view
    if (view?.kind !== 'files' && view?.kind !== 'confirm') return { kind: 'expired' }
    const entry = await deps.getEntry(view.entryId)
    if (!entry) return missingEntry(session)
    const next: TelegramInboxSession = {
      ...session,
      view: { kind: 'files', entryId: view.entryId, page: control.page },
    }
    return { kind: 'show', form: formatTelegramInboxFilesPage(entry, control.page), session: next }
  }

  if (control.kind === 'inbox-doc') {
    const entryId = session.view?.entryId ?? session.entryIds?.[0]
    if (!entryId) return { kind: 'expired' }
    const entry = await deps.getEntry(entryId)
    if (!entry) return missingEntry(session)
    const doc = entry.docs?.[control.docIndex]
    if (!doc) {
      return {
        kind: 'error',
        text: 'That file is no longer listed on this Inbox item. Send /inbox again.',
        session,
      }
    }
    const filePage = session.view?.kind === 'files'
      ? session.view.page
      : Math.floor(control.docIndex / TELEGRAM_INBOX_FILE_PAGE_SIZE)
    const next: TelegramInboxSession = {
      ...session,
      view: { kind: 'confirm', entryId, docIndex: control.docIndex, filePage },
    }
    return {
      kind: 'show',
      form: formatTelegramInboxConfirmPage(inboxFileDisplayName(doc.path)),
      session: next,
    }
  }

  if (control.kind === 'inbox-cancel') {
    if (session.view?.kind !== 'confirm') return { kind: 'expired' }
    const entry = await deps.getEntry(session.view.entryId)
    if (!entry) return missingEntry(session)
    const next: TelegramInboxSession = {
      ...session,
      view: { kind: 'files', entryId: session.view.entryId, page: session.view.filePage },
    }
    return {
      kind: 'show',
      form: formatTelegramInboxFilesPage(entry, session.view.filePage),
      session: next,
    }
  }

  if (control.kind === 'inbox-send') {
    if (session.view?.kind !== 'confirm') return { kind: 'expired' }
    const entry = await deps.getEntry(session.view.entryId)
    if (!entry) return missingEntry(session)
    const doc = entry.docs?.[session.view.docIndex]
    if (!doc) {
      return {
        kind: 'error',
        text: 'That file is no longer listed on this Inbox item. Send /inbox again.',
        session,
      }
    }
    const next: TelegramInboxSession = {
      ...session,
      view: { kind: 'requesting', entryId: session.view.entryId, docIndex: session.view.docIndex },
    }
    return {
      kind: 'request-artifact',
      entryId: session.view.entryId,
      docIndex: session.view.docIndex,
      form: formatTelegramInboxRequestingPage(inboxFileDisplayName(doc.path)),
      session: next,
    }
  }

  return { kind: 'ignored' }
}

export function assertTelegramFormBounds(form: TelegramForm): void {
  if (form.text.length >= TELEGRAM_PLAIN_TEXT_MAX) {
    throw new Error('Telegram form text exceeds the plain-text cap')
  }
  for (const row of form.actions) {
    for (const action of row) {
      if (action.text.length > TELEGRAM_BUTTON_TEXT_MAX) {
        throw new Error('Telegram button text exceeds 64 characters')
      }
      if (Buffer.byteLength(action.data, 'utf8') > TELEGRAM_CALLBACK_DATA_MAX) {
        throw new Error('Telegram callback data exceeds 64 bytes')
      }
    }
  }
}

function missingEntry(session: TelegramInboxSession): TelegramInboxResolution {
  return {
    kind: 'error',
    text: 'That Inbox item is no longer available. Send /inbox again.',
    session,
  }
}

function button(text: string, data: string): TelegramFormAction {
  if (Buffer.byteLength(data, 'utf8') > TELEGRAM_CALLBACK_DATA_MAX) {
    throw new Error('Telegram callback data exceeds 64 bytes')
  }
  return { text: truncateTelegramText(text, TELEGRAM_BUTTON_TEXT_MAX), data }
}

function fitPageText(text: string): string {
  return truncateTelegramText(text.trimEnd(), TELEGRAM_INBOX_PAGE_HARD_MAX)
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function formatInboxWhen(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}
