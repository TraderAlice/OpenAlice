import type { InboxEntry } from '@/core/inbox-store.js'

export const TELEGRAM_INBOX_PAGE_SIZE = 5

export type TelegramControl =
  | { kind: 'inbox'; direction: 'older' | 'newer' }
  | { kind: 'settings'; inboxPush: boolean }

export interface TelegramInboxSession {
  stack: string[]
  before?: string
}

export function parseTelegramControl(data: string): TelegramControl | undefined {
  if (data === 'i:o') return { kind: 'inbox', direction: 'older' }
  if (data === 'i:n') return { kind: 'inbox', direction: 'newer' }
  if (data === 's:p:0') return { kind: 'settings', inboxPush: false }
  if (data === 's:p:1') return { kind: 'settings', inboxPush: true }
  return undefined
}

export function inboxEntryTitle(entry: InboxEntry): string {
  const comment = entry.comments?.trim()
  if (comment) return comment.split('\n')[0]!.slice(0, 80)
  return entry.docs?.[0]?.path ?? 'Inbox item'
}

export function formatTelegramInboxPage(input: {
  entries: InboxEntry[]
  hasMore: boolean
  canGoNewer: boolean
}): { text: string; actions: Array<Array<{ text: string; data: string }>> } {
  if (input.entries.length === 0) {
    return {
      text: input.canGoNewer
        ? 'No older unread Inbox items.'
        : 'No unread Inbox items. Open Inbox in OpenAlice for the full history.',
      actions: input.canGoNewer ? [[{ text: 'Newer', data: 'i:n' }]] : [],
    }
  }

  const lines = ['Inbox · unread', '']
  for (const [index, entry] of input.entries.entries()) {
    const workspace = entry.workspaceLabel ?? entry.workspaceId
    const when = new Date(entry.ts).toISOString().slice(0, 16).replace('T', ' ')
    const body = (entry.comments ?? '').trim()
    const extra = body.includes('\n') ? body.slice(body.indexOf('\n') + 1).trim() : ''
    lines.push(`${index + 1}. ${inboxEntryTitle(entry)}`)
    lines.push(`${workspace} · ${when}`)
    if (extra) lines.push(extra.slice(0, 240))
    if ((entry.docs?.length ?? 0) > 0) {
      lines.push(`Files: ${entry.docs!.map((doc) => doc.path).join(', ')}`)
    }
    lines.push('')
  }

  const row: Array<{ text: string; data: string }> = []
  if (input.canGoNewer) row.push({ text: 'Newer', data: 'i:n' })
  if (input.hasMore) row.push({ text: 'Older', data: 'i:o' })
  return { text: lines.join('\n').trimEnd(), actions: row.length > 0 ? [row] : [] }
}

export function formatTelegramSettingsPage(inboxPush: boolean): {
  text: string
  actions: Array<Array<{ text: string; data: string }>>
} {
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
        ? { text: 'Turn off push', data: 's:p:0' }
        : { text: 'Turn on push', data: 's:p:1' },
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
      stack: [...session.stack, session.before ?? ''],
      before: oldestId,
    }
  }
  const stack = [...session.stack]
  const before = stack.pop()
  return { stack, before: before || undefined }
}
