import { describe, expect, it } from 'vitest'
import { TELEGRAM_PLAIN_TEXT_MAX } from '@traderalice/connector-protocol'
import type { InboxEntry } from '@/core/inbox-store.js'
import {
  TELEGRAM_BUTTON_TEXT_MAX,
  TELEGRAM_CALLBACK_DATA_MAX,
  TELEGRAM_INBOX_PAGE_HARD_MAX,
  TELEGRAM_INBOX_PAGE_SIZE,
  advanceInboxSession,
  assertTelegramFormBounds,
  formatTelegramInboxConfirmPage,
  formatTelegramInboxDetailPage,
  formatTelegramInboxFilesPage,
  formatTelegramInboxPage,
  formatTelegramSettingsPage,
  inboxFileDisplayName,
  parseTelegramControl,
  transitionTelegramInbox,
  truncateTelegramText,
} from './telegram-controls.js'

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'entry-1',
    workspaceId: 'ws-1',
    workspaceLabel: 'Research',
    comments: 'Overnight risk\nThree findings.',
    ts: Date.parse('2026-08-14T15:02:00.000Z'),
    ...overrides,
  }
}

function collectActions(form: { actions: Array<Array<{ text: string; data: string }>> }) {
  return form.actions.flat()
}

describe('Telegram interactive controls', () => {
  it('parses button payloads without command params or raw paths', () => {
    expect(parseTelegramControl('i:o')).toEqual({ kind: 'inbox', direction: 'older' })
    expect(parseTelegramControl('i:n')).toEqual({ kind: 'inbox', direction: 'newer' })
    expect(parseTelegramControl('i:s:u')).toEqual({ kind: 'inbox-scope', scope: 'unread' })
    expect(parseTelegramControl('i:s:a')).toEqual({ kind: 'inbox-scope', scope: 'all' })
    expect(parseTelegramControl('i:e:2')).toEqual({ kind: 'inbox-entry', entryIndex: 2 })
    expect(parseTelegramControl('i:b')).toEqual({ kind: 'inbox-back' })
    expect(parseTelegramControl('i:v')).toEqual({ kind: 'inbox-open-files' })
    expect(parseTelegramControl('i:f:0')).toEqual({ kind: 'inbox-files', entryIndex: 0 })
    expect(parseTelegramControl('i:f:4')).toEqual({ kind: 'inbox-files', entryIndex: 4 })
    expect(parseTelegramControl('i:fp:2')).toEqual({ kind: 'inbox-files-page', page: 2 })
    expect(parseTelegramControl('i:fp:199')).toEqual({ kind: 'inbox-files-page', page: 199 })
    expect(parseTelegramControl('i:d:12')).toEqual({ kind: 'inbox-doc', docIndex: 12 })
    expect(parseTelegramControl('i:y')).toEqual({ kind: 'inbox-send' })
    expect(parseTelegramControl('i:x')).toEqual({ kind: 'inbox-cancel' })
    expect(parseTelegramControl('s:p:0')).toEqual({ kind: 'settings', inboxPush: false })
    expect(parseTelegramControl('s:p:1')).toEqual({ kind: 'settings', inboxPush: true })
    expect(parseTelegramControl('nope')).toBeUndefined()
    expect(parseTelegramControl('i:f:5')).toBeUndefined()
    expect(parseTelegramControl('i:f:../secret')).toBeUndefined()
    expect(parseTelegramControl('i:d:/etc/passwd')).toBeUndefined()
    expect(parseTelegramControl('i:d:1000')).toBeUndefined()
    expect(parseTelegramControl('x'.repeat(TELEGRAM_CALLBACK_DATA_MAX + 1))).toBeUndefined()
  })

  it('renders an unread Inbox page with Older when more remain', () => {
    const page = formatTelegramInboxPage({
      entries: [entry()],
      hasMore: true,
      canGoNewer: false,
      scope: 'unread',
    })
    expect(page.text).toContain('Inbox · unread')
    expect(page.text).toContain('1. Overnight risk')
    expect(page.text).toContain('Three findings.')
    expect(page.actions).toEqual([
      [{ text: '✓ Unread', data: 'i:s:u' }, { text: 'All', data: 'i:s:a' }],
      [{ text: '1 · Overnight risk', data: 'i:e:0' }],
      [{ text: 'Older', data: 'i:o' }],
    ])
  })

  it('summarizes attachments by count and opens the entry detail', () => {
    const page = formatTelegramInboxPage({
      entries: [entry({
        docs: [
          { path: 'research/deep/nested/overnight-risk.md' },
          { path: 'research/deep/nested/dashboard.html' },
        ],
      })],
      hasMore: false,
      canGoNewer: false,
      scope: 'unread',
    })
    expect(page.text).toContain('Files: 2')
    expect(page.text).not.toContain('research/deep/nested')
    expect(collectActions(page).map((action) => action.data)).toEqual(['i:s:u', 'i:s:a', 'i:e:0'])
    assertTelegramFormBounds(page)
  })

  it('keeps a full five-item page strictly under the Telegram plain-text cap', () => {
    const long = `${'😀'.repeat(800)}${'研究工作区'.repeat(400)}${'a'.repeat(2000)}`
    const longPath = `${long}/reports/${long}.md`
    const entries = Array.from({ length: TELEGRAM_INBOX_PAGE_SIZE }, (_, index) => entry({
      id: `entry-${index}`,
      workspaceLabel: long,
      comments: `${long}\n${long}\n${long}`,
      docs: [{ path: longPath }, { path: `${long}/notes.txt` }],
    }))
    const page = formatTelegramInboxPage({
      entries,
      hasMore: true,
      canGoNewer: true,
      scope: 'unread',
    })
    const again = formatTelegramInboxPage({
      entries,
      hasMore: true,
      canGoNewer: true,
      scope: 'unread',
    })
    expect(page.text).toBe(again.text)
    expect(page.text.length).toBeLessThan(TELEGRAM_PLAIN_TEXT_MAX)
    expect(page.text.length).toBeLessThanOrEqual(TELEGRAM_INBOX_PAGE_HARD_MAX)
    expect(page.text).not.toContain(long)
    expect(page.text).not.toContain(longPath)
    expect(page.text.match(/^Files: \d+$/gm)).toEqual([
      'Files: 2',
      'Files: 2',
      'Files: 2',
      'Files: 2',
      'Files: 2',
    ])
    const actions = collectActions(page)
    expect(actions.map((action) => action.data)).toEqual([
      'i:s:u', 'i:s:a',
      'i:e:0', 'i:e:1', 'i:e:2', 'i:e:3', 'i:e:4',
      'i:n', 'i:o',
    ])
    for (const action of actions) {
      expect(action.text.length).toBeLessThanOrEqual(TELEGRAM_BUTTON_TEXT_MAX)
      expect(Buffer.byteLength(action.data, 'utf8')).toBeLessThanOrEqual(TELEGRAM_CALLBACK_DATA_MAX)
    }
    assertTelegramFormBounds(page)
  })

  it('truncates without splitting emoji surrogate pairs', () => {
    expect(truncateTelegramText('😀😀😀', 5)).toBe('😀😀…')
    expect(inboxFileDisplayName('research/deep/报告 😀.md')).toBe('报告 😀.md')
  })

  it('renders a bounded detail view before exposing its files', () => {
    const detail = formatTelegramInboxDetailPage(entry({
      comments: `Overnight risk\n\n${'Finding. '.repeat(400)}`,
      docs: [{ path: 'research/close.md' }],
    }))
    expect(detail.text).toContain('Overnight risk')
    expect(detail.text).toContain('Files: 1')
    expect(detail.text.length).toBeLessThanOrEqual(TELEGRAM_INBOX_PAGE_HARD_MAX)
    expect(detail.actions).toEqual([
      [{ text: 'View 1 file', data: 'i:v' }],
      [{ text: 'Back to Inbox', data: 'i:b' }],
    ])
    assertTelegramFormBounds(detail)
  })

  it('keeps Inbox paging on the same form via a cursor stack', () => {
    const first = { stack: [] as string[], scope: 'all' as const }
    const older = advanceInboxSession(first, 'older', 'entry-5')
    expect(older).toEqual({ stack: [''], scope: 'all', before: 'entry-5' })
    expect(advanceInboxSession(older, 'newer')).toEqual({ stack: [], scope: 'all', before: undefined })
  })

  it('renders Settings as a single toggle button', () => {
    const on = formatTelegramSettingsPage(true)
    expect(on.text).toContain('Inbox push: On')
    expect(on.actions).toEqual([[{ text: 'Turn off push', data: 's:p:0' }]])
    const off = formatTelegramSettingsPage(false)
    expect(off.text).toContain('Inbox push: Off')
    expect(off.actions).toEqual([[{ text: 'Turn on push', data: 's:p:1' }]])
  })

  it('pages a file list with safe display names and bounded callbacks', () => {
    const docs = Array.from({ length: 7 }, (_, index) => ({
      path: `research/very/deep/${'x'.repeat(80)}-${index}.md`,
    }))
    const page = formatTelegramInboxFilesPage(entry({ comments: 'Risk', docs }), 0)
    expect(page.text).toContain('Files · Risk')
    expect(page.text).not.toContain('research/very/deep')
    expect(page.text).toContain('1. ')
    expect(collectActions(page).map((action) => action.data)).toEqual([
      'i:d:0',
      'i:d:1',
      'i:d:2',
      'i:d:3',
      'i:d:4',
      'i:b',
      'i:fp:1',
    ])
    assertTelegramFormBounds(page)
    const next = formatTelegramInboxFilesPage(entry({ comments: 'Risk', docs }), 1)
    expect(collectActions(next).some((action) => action.data === 'i:d:5')).toBe(true)
    assertTelegramFormBounds(next)
  })

  it('asks for confirmation without embedding a workspace path', () => {
    const form = formatTelegramInboxConfirmPage('close.md')
    expect(form.text).toContain('Send the current version of close.md?')
    expect(form.text).toContain('does not mark the Inbox item read')
    expect(form.actions).toEqual([[
      { text: 'Send', data: 'i:y' },
      { text: 'Cancel', data: 'i:x' },
    ]])
    assertTelegramFormBounds(form)
  })
})

describe('Telegram inbox control transitions', () => {
  const listed = entry({
    id: 'entry-1',
    docs: [{ path: 'research/close.md' }, { path: 'research/dash.html' }],
  })

  it('rejects non-owner callbacks before any settings or file action', async () => {
    const getEntry = async () => listed
    await expect(transitionTelegramInbox(
      { stack: [], entryIds: ['entry-1'] },
      { kind: 'settings', inboxPush: false },
      { isOwner: false, getEntry },
    )).resolves.toEqual({ kind: 'forbidden' })
    await expect(transitionTelegramInbox(
      { stack: [], entryIds: ['entry-1'] },
      { kind: 'inbox-files', entryIndex: 0 },
      { isOwner: false, getEntry },
    )).resolves.toEqual({ kind: 'forbidden' })
    await expect(transitionTelegramInbox(
      { stack: [], view: { kind: 'confirm', entryId: 'entry-1', docIndex: 0, filePage: 0 } },
      { kind: 'inbox-send' },
      { isOwner: false, getEntry },
    )).resolves.toEqual({ kind: 'forbidden' })
  })

  it('switches between unread and full history while resetting pagination', async () => {
    await expect(transitionTelegramInbox(
      { stack: ['', 'older'], scope: 'unread', before: 'entry-5', entryIds: ['entry-1'] },
      { kind: 'inbox-scope', scope: 'all' },
      { isOwner: true, getEntry: async () => listed },
    )).resolves.toEqual({
      kind: 'reload-inbox',
      session: { stack: [], scope: 'all', entryIds: [], view: undefined },
    })
  })

  it('opens an entry detail before its file list and returns through the same layers', async () => {
    const detail = await transitionTelegramInbox(
      { stack: [], scope: 'all', entryIds: ['entry-1'] },
      { kind: 'inbox-entry', entryIndex: 0 },
      { isOwner: true, getEntry: async () => listed },
    )
    expect(detail.kind).toBe('show')
    if (detail.kind !== 'show') return
    expect(detail.session.view).toEqual({ kind: 'detail', entryId: 'entry-1' })
    expect(detail.form.text).toContain('Overnight risk')

    const files = await transitionTelegramInbox(
      detail.session,
      { kind: 'inbox-open-files' },
      { isOwner: true, getEntry: async () => listed },
    )
    expect(files.kind).toBe('show')
    if (files.kind !== 'show') return
    expect(files.session.view).toEqual({ kind: 'files', entryId: 'entry-1', page: 0 })

    const back = await transitionTelegramInbox(
      files.session,
      { kind: 'inbox-back' },
      { isOwner: true, getEntry: async () => listed },
    )
    expect(back.kind).toBe('show')
    if (back.kind !== 'show') return
    expect(back.session.view).toEqual({ kind: 'detail', entryId: 'entry-1' })
  })

  it('opens a file list from a page-local entry index', async () => {
    const resolution = await transitionTelegramInbox(
      { stack: [], entryIds: ['entry-1'] },
      { kind: 'inbox-files', entryIndex: 0 },
      { isOwner: true, getEntry: async () => listed },
    )
    expect(resolution.kind).toBe('show')
    if (resolution.kind !== 'show') return
    expect(resolution.session.view).toEqual({ kind: 'files', entryId: 'entry-1', page: 0 })
    expect(resolution.form.text).toContain('close.md')
    expect(resolution.form.text).not.toContain('research/close.md')
  })

  it('confirms a selected file and only then asks Alice to send it', async () => {
    const getEntry = async () => listed
    const session = { stack: [] as string[], entryIds: ['entry-1'], view: { kind: 'files' as const, entryId: 'entry-1', page: 0 } }
    const confirm = await transitionTelegramInbox(session, { kind: 'inbox-doc', docIndex: 1 }, { isOwner: true, getEntry })
    expect(confirm.kind).toBe('show')
    if (confirm.kind !== 'show') return
    expect(confirm.form.text).toContain('dash.html')
    expect(confirm.session.view).toMatchObject({ kind: 'confirm', entryId: 'entry-1', docIndex: 1 })

    const send = await transitionTelegramInbox(confirm.session, { kind: 'inbox-send' }, { isOwner: true, getEntry })
    expect(send).toMatchObject({
      kind: 'request-artifact',
      entryId: 'entry-1',
      docIndex: 1,
    })
  })

  it('cancels confirmation without requesting a file', async () => {
    const resolution = await transitionTelegramInbox(
      { stack: [], entryIds: ['entry-1'], view: { kind: 'confirm', entryId: 'entry-1', docIndex: 0, filePage: 0 } },
      { kind: 'inbox-cancel' },
      { isOwner: true, getEntry: async () => listed },
    )
    expect(resolution.kind).toBe('show')
    if (resolution.kind !== 'show') return
    expect(resolution.session.view).toEqual({ kind: 'files', entryId: 'entry-1', page: 0 })
    expect(resolution.form.text).toContain('close.md')
  })

  it('treats a missing session or deleted entry as a safe failure', async () => {
    await expect(transitionTelegramInbox(
      undefined,
      { kind: 'inbox-files', entryIndex: 0 },
      { isOwner: true, getEntry: async () => listed },
    )).resolves.toEqual({ kind: 'expired' })
    const missing = await transitionTelegramInbox(
      { stack: [], entryIds: ['gone'] },
      { kind: 'inbox-files', entryIndex: 0 },
      { isOwner: true, getEntry: async () => null },
    )
    expect(missing).toMatchObject({
      kind: 'error',
      text: 'That Inbox item is no longer available. Send /inbox again.',
    })
  })
})
