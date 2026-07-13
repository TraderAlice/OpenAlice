import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { InboxNotification } from '@traderalice/connector-protocol'
import {
  AdapterHealthTracker,
  decodeInboxAttachments,
  formatInboxNotification,
  formatPlainInboxNotification,
} from './shared.js'

const notification: InboxNotification = {
  id: 'fixture-1',
  createdAt: '2026-07-13T00:00:00.000Z',
  workspaceId: 'ws-1',
  workspaceLabel: 'Research *desk*',
  title: 'Close [scan]',
  body: 'Three findings.',
  provenance: { resumeId: 'resume-calm-river-12ab' },
  href: 'https://openalice.example/inbox',
}

describe('recorded Inbox payload formatting', () => {
  it('replays deterministically into Discord markdown', () => {
    expect(formatInboxNotification(notification)).toBe([
      '**Close \\[scan\\]**',
      'Workspace: Research \\*desk\\*',
      'From: @resume\\-calm\\-river\\-12ab',
      '',
      'Three findings.',
      '',
      'https://openalice.example/inbox',
    ].join('\n'))
  })

  it('replays deterministically into Telegram plain text', () => {
    expect(formatPlainInboxNotification(notification)).toBe([
      'Close [scan]',
      'Workspace: Research *desk*',
      'From: @resume-calm-river-12ab',
      '',
      'Three findings.',
      '',
      'https://openalice.example/inbox',
    ].join('\n'))
  })

  it('keeps the runtime label and visible Session signature together', () => {
    expect(formatPlainInboxNotification({
      ...notification,
      provenance: { actorLabel: 'pi', resumeId: 'resume-calm-river-12ab' },
    })).toContain('From: pi · @resume-calm-river-12ab')
  })

  it.each([
    ['Markdown', 'close.md', 'text/markdown; charset=utf-8', '# Close scan\n'],
    ['HTML', 'close.html', 'text/html; charset=utf-8', '<!doctype html><h1>Close scan</h1>\n'],
  ])('decodes and verifies %s attachments', (_label, filename, mediaType, body) => {
    const content = Buffer.from(body)
    const decoded = decodeInboxAttachments({
      ...notification,
      attachments: [{
        filename,
        mediaType,
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      }],
    })
    expect(decoded).toEqual([{
      filename,
      mediaType,
      content,
    }])
  })

  it('rejects attachment bytes that do not match their digest', () => {
    expect(() => decodeInboxAttachments({
      ...notification,
      attachments: [{
        filename: 'close.md',
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: 1,
        contentSha256: '0'.repeat(64),
        contentBase64: Buffer.from('x').toString('base64'),
      }],
    })).toThrow('digest mismatch')
  })
})

describe('connector linking health', () => {
  it('keeps an online unlinked bot distinct from healthy delivery', () => {
    const tracker = new AdapterHealthTracker('telegram')
    tracker.awaitingLink()

    expect(tracker.get()).toMatchObject({
      id: 'telegram',
      enabled: true,
      status: 'awaiting_link',
      detail: 'Bot is online and waiting for the owner to run /link.',
    })

    tracker.healthy('owner-1')
    expect(tracker.get()).toMatchObject({ status: 'healthy', owner: 'owner-1' })
    expect(tracker.get().detail).toBeUndefined()
  })
})
