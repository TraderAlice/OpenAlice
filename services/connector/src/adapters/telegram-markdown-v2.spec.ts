import { describe, expect, it } from 'vitest'
import type { InboxNotification } from '@traderalice/connector-protocol'
import {
  escapeTelegramMarkdownV2,
  formatTelegramInboxMarkdownV2,
  toTelegramMarkdownV2,
} from './telegram-markdown-v2.js'

describe('Telegram MarkdownV2 conversion', () => {
  it('escapes sendMessage specials in literal text', () => {
    expect(escapeTelegramMarkdownV2('Hello, world! @resume-calm.')).toBe(
      'Hello, world\\! @resume\\-calm\\.',
    )
  })

  it('maps common GFM markers onto MarkdownV2', () => {
    expect(toTelegramMarkdownV2('**bold** and *italic* and ~~old~~')).toBe(
      '*bold* and _italic_ and ~old~',
    )
    expect(toTelegramMarkdownV2('`code.dot` and [docs](https://t.me/foo)')).toBe(
      '`code.dot` and [docs](https://t.me/foo)',
    )
  })

  it('turns headings and lists into MarkdownV2-safe lines', () => {
    expect(toTelegramMarkdownV2([
      '# Overnight risk',
      '',
      '- one',
      '1. two',
      '> quoted',
    ].join('\n'))).toBe([
      '*Overnight risk*',
      '',
      '• one',
      '1\\. two',
      '>quoted',
    ].join('\n'))
  })

  it('keeps unmatched markers literal instead of emitting broken entities', () => {
    expect(toTelegramMarkdownV2('price is 3*2=6.')).toBe('price is 3\\*2\\=6\\.')
  })

  it('preserves fenced code without treating inner specials as markup', () => {
    expect(toTelegramMarkdownV2('see\n```ts\nconst n = 1.0\n```\n')).toBe(
      'see\n```ts\nconst n = 1.0\n```\n',
    )
  })

  it('formats Inbox titles as escaped MarkdownV2 instead of GFM', () => {
    const notification: InboxNotification = {
      id: 'inbox-1',
      createdAt: '2026-07-13T00:00:00.000Z',
      workspaceId: 'ws-1',
      workspaceLabel: 'Research *desk*',
      title: 'Close [scan]',
      body: 'Three **findings**.',
      provenance: { resumeId: 'resume-calm-river-12ab' },
      href: 'https://openalice.example/inbox',
    }
    expect(formatTelegramInboxMarkdownV2(notification)).toBe([
      '*Close \\[scan\\]*',
      'Workspace: Research \\*desk\\*',
      'From: @resume\\-calm\\-river\\-12ab',
      '',
      'Three *findings*\\.',
      '',
      'https://openalice\\.example/inbox',
    ].join('\n'))
  })
})
