import { describe, expect, it } from 'vitest'
import type { InboxEntry } from '@/core/inbox-store.js'
import {
  advanceInboxSession,
  formatTelegramInboxPage,
  formatTelegramSettingsPage,
  parseTelegramControl,
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

describe('Telegram interactive controls', () => {
  it('parses button payloads without command params', () => {
    expect(parseTelegramControl('i:o')).toEqual({ kind: 'inbox', direction: 'older' })
    expect(parseTelegramControl('i:n')).toEqual({ kind: 'inbox', direction: 'newer' })
    expect(parseTelegramControl('s:p:0')).toEqual({ kind: 'settings', inboxPush: false })
    expect(parseTelegramControl('s:p:1')).toEqual({ kind: 'settings', inboxPush: true })
    expect(parseTelegramControl('nope')).toBeUndefined()
  })

  it('renders an unread Inbox page with Older when more remain', () => {
    const page = formatTelegramInboxPage({
      entries: [entry()],
      hasMore: true,
      canGoNewer: false,
    })
    expect(page.text).toContain('Inbox · unread')
    expect(page.text).toContain('1. Overnight risk')
    expect(page.text).toContain('Three findings.')
    expect(page.actions).toEqual([[{ text: 'Older', data: 'i:o' }]])
  })

  it('keeps Inbox paging on the same form via a cursor stack', () => {
    const first = { stack: [] as string[] }
    const older = advanceInboxSession(first, 'older', 'entry-5')
    expect(older).toEqual({ stack: [''], before: 'entry-5' })
    expect(advanceInboxSession(older, 'newer')).toEqual({ stack: [], before: undefined })
  })

  it('renders Settings as a single toggle button', () => {
    const on = formatTelegramSettingsPage(true)
    expect(on.text).toContain('Inbox push: On')
    expect(on.actions).toEqual([[{ text: 'Turn off push', data: 's:p:0' }]])
    const off = formatTelegramSettingsPage(false)
    expect(off.text).toContain('Inbox push: Off')
    expect(off.actions).toEqual([[{ text: 'Turn on push', data: 's:p:1' }]])
  })
})
