import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { InboxNotification } from '@traderalice/connector-protocol'
import {
  AdapterHealthTracker,
  classifyNetworkStartFailure,
  decodeInboxAttachments,
  formatAdapterError,
  formatInboxNotification,
  formatPlainInboxNotification,
  superviseLongConnection,
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

describe('adapter error formatting', () => {
  it('includes nested fetch causes so Settings can show the real network failure', () => {
    const error = new Error("Network request for 'setMyCommands' failed!")
    error.cause = new Error('connect ECONNREFUSED 198.18.0.130:443')
    expect(formatAdapterError(error)).toBe(
      "Network request for 'setMyCommands' failed! — connect ECONNREFUSED 198.18.0.130:443",
    )
    const tracker = new AdapterHealthTracker('telegram')
    tracker.degraded(error)
    expect(tracker.get().lastError).toContain('ECONNREFUSED')
  })
})

describe('adapter-owned start failure classification', () => {
  it('retries transport failures without teaching core platform error strings', () => {
    expect(classifyNetworkStartFailure(new Error('connect ECONNREFUSED 198.18.0.130:443'))).toBe('retry')
    expect(classifyNetworkStartFailure(new Error('Slack setting botToken is required'))).toBe('fatal')
  })
})

describe('long-connection supervisor', () => {
  it('reconnects after a dropped session and stops when asked', async () => {
    let sessions = 0
    let stopped = false
    const disconnects: number[] = []
    const failures: string[] = []
    const loop = superviseLongConnection({
      label: 'probe',
      isStopped: () => stopped,
      runSession: async () => {
        sessions += 1
        if (sessions === 1) throw new Error('Network request for \'getUpdates\' failed!')
        stopped = true
      },
      disconnect: async () => { disconnects.push(sessions) },
      onFailure: (error) => { failures.push(error instanceof Error ? error.message : String(error)) },
      delay: async () => undefined,
      reconnectDelayMs: 1,
    })

    await loop
    expect(failures[0]).toContain('getUpdates')
    expect(disconnects.length).toBeGreaterThanOrEqual(1)
  })

  it('applies bounded jitter to reconnect delays', async () => {
    let stopped = false
    const delays: number[] = []
    await superviseLongConnection({
      label: 'probe',
      isStopped: () => stopped,
      runSession: async () => { throw new Error('offline') },
      disconnect: async () => undefined,
      onFailure: () => undefined,
      onRetryScheduled: (delayMs) => { delays.push(delayMs) },
      delay: async () => { stopped = true },
      reconnectDelayMs: 1_000,
      retryJitterRatio: 0.2,
      random: () => 1,
    })

    expect(delays).toEqual([1_200])
  })

  it('resets failure backoff after a session reached healthy state', async () => {
    let stopped = false
    let healthy = false
    let sessions = 0
    const failures: number[] = []
    await superviseLongConnection({
      label: 'probe',
      isStopped: () => stopped,
      isSessionHealthy: () => healthy,
      runSession: async () => {
        sessions += 1
        healthy = sessions === 2
        throw new Error('offline')
      },
      disconnect: async () => undefined,
      onFailure: () => undefined,
      onRetryScheduled: (_delayMs, count) => { failures.push(count) },
      delay: async () => { if (sessions === 2) stopped = true },
      reconnectDelayMs: 1,
      retryJitterRatio: 0,
    })

    expect(failures).toEqual([1, 1])
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
      consecutiveFailures: 0,
    })

    tracker.healthy('owner-1')
    expect(tracker.get()).toMatchObject({ status: 'healthy', owner: 'owner-1' })
    expect(tracker.get().detail).toBeUndefined()
  })
})
