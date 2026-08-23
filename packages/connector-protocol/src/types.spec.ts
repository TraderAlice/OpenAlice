import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ACTION_TTL_MS,
  MAX_CONNECTOR_ATTACHMENT_BYTES,
  OWNER_CHAT_TEXT_MAX,
  artifactFailureMessage,
  connectorArtifactDeliverySchema,
  connectorArtifactFailureSchema,
  connectorArtifactRequestSchema,
  connectorUtaPresentationSchema,
  connectorUtaRequestSchema,
  inboxNotificationSchema,
  isConnectorActionExpired,
  isInboxPushEnabled,
  ownerChatMessageSchema,
  utaFailureMessage,
} from './types.js'

const baseNotification = {
  id: 'inbox-1',
  createdAt: '2026-07-13T00:00:00.000Z',
  workspaceId: 'ws-1',
  title: 'Report ready',
  body: '',
}

describe('owner chat messages', () => {
  it('requires lifecycle identity and text for visible phases', () => {
    const base = {
      id: 'desk-1',
      adapterId: 'telegram',
      conversationId: 'comment-1',
    }
    expect(ownerChatMessageSchema.parse({
      ...base,
      phase: 'accepted',
    }).phase).toBe('accepted')
    expect(() => ownerChatMessageSchema.parse({
      ...base,
      phase: 'progress',
    })).toThrow()
    expect(ownerChatMessageSchema.parse({
      ...base,
      phase: 'final',
      text: 'Markets are quiet.',
    }).text).toBe('Markets are quiet.')
    expect(ownerChatMessageSchema.parse({
      ...base,
      phase: 'failed',
      text: 'x'.repeat(OWNER_CHAT_TEXT_MAX),
    }).text).toHaveLength(OWNER_CHAT_TEXT_MAX)
    expect(() => ownerChatMessageSchema.parse({
      ...base,
      phase: 'final',
      text: 'x'.repeat(OWNER_CHAT_TEXT_MAX + 1),
    })).toThrow()
  })
})

describe('UTA review control plane', () => {
  it('keeps UTA requests to action + optional account identity', () => {
    expect(connectorUtaRequestSchema.parse({
      requestId: 'uta-1',
      connectorId: 'telegram',
      createdAt: '2026-08-14T15:02:00.000Z',
      action: 'review',
    }).action).toBe('review')
    expect(() => connectorUtaRequestSchema.parse({
      requestId: 'uta-1',
      connectorId: 'telegram',
      createdAt: '2026-08-14T15:02:00.000Z',
      action: 'stage',
    })).toThrow()
    expect(() => connectorUtaRequestSchema.parse({
      requestId: 'uta-1',
      connectorId: 'telegram',
      createdAt: '2026-08-14T15:02:00.000Z',
      action: 'push',
      utaId: 'alpaca-paper',
    })).toThrow()
    expect(connectorUtaRequestSchema.parse({
      requestId: 'uta-1',
      connectorId: 'telegram',
      createdAt: '2026-08-14T15:02:00.000Z',
      action: 'push',
      utaId: 'alpaca-paper',
      pendingHash: 'abc12345',
    }).pendingHash).toBe('abc12345')
  })

  it('rejects an oversized review payload', () => {
    expect(() => connectorUtaPresentationSchema.parse({
      requestId: 'uta-1',
      connectorId: 'telegram',
      review: {
        generatedAt: '2026-08-14T15:02:00.000Z',
        accounts: [{
          id: 'alpaca-paper',
          label: 'Alpaca',
          pendingMessage: null,
          pendingHash: null,
          stagedCount: 0,
          operations: [{ action: 'placeOrder', summary: 'x'.repeat(121) }],
        }],
      },
    })).toThrow()
    expect(utaFailureMessage('conflict')).toContain('/uta')
  })
})

describe('Inbox push preference', () => {
  it('defaults to on so existing installs keep delivering', () => {
    expect(isInboxPushEnabled({})).toBe(true)
    expect(isInboxPushEnabled({ inboxPush: true })).toBe(true)
    expect(isInboxPushEnabled({ inboxPush: false })).toBe(false)
  })
})

describe('Inbox notification attachments', () => {
  it('accepts a bounded Markdown file payload', () => {
    const content = Buffer.from('# Report\n')
    const source = Buffer.from('# Report\n', 'utf8')
    expect(inboxNotificationSchema.parse({
      ...baseNotification,
      attachments: [{
        filename: 'report.md',
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        source: {
          sizeBytes: source.byteLength,
          contentSha256: createHash('sha256').update(source).digest('hex'),
          detectedEncoding: 'UTF-8',
          detectionConfidence: 100,
        },
        contentBase64: content.toString('base64'),
      }],
    }).attachments).toHaveLength(1)
  })

  it('rejects attachment metadata above the one-file limit', () => {
    expect(() => inboxNotificationSchema.parse({
      ...baseNotification,
      attachments: [{
        filename: 'too-large.md',
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: MAX_CONNECTOR_ATTACHMENT_BYTES + 1,
        contentSha256: '0'.repeat(64),
        contentBase64: '',
      }],
    })).toThrow()
  })
})

describe('Connector artifact request protocol', () => {
  const request = {
    requestId: 'art-1',
    connectorId: 'telegram',
    entryId: 'entry-1',
    docIndex: 0,
    createdAt: '2026-08-14T15:02:00.000Z',
  }

  it('accepts an entry id and doc index and ignores a raw path field', () => {
    const parsed = connectorArtifactRequestSchema.parse({
      ...request,
      path: '/etc/passwd',
    })
    expect(parsed).toEqual(request)
    expect(parsed).not.toHaveProperty('path')
  })

  it('rejects missing ids, oversized ids, and out-of-range doc indexes', () => {
    expect(() => connectorArtifactRequestSchema.parse({ ...request, requestId: '' })).toThrow()
    expect(() => connectorArtifactRequestSchema.parse({ ...request, entryId: 'e'.repeat(129) })).toThrow()
    expect(() => connectorArtifactRequestSchema.parse({ ...request, docIndex: -1 })).toThrow()
    expect(() => connectorArtifactRequestSchema.parse({ ...request, docIndex: 1000 })).toThrow()
  })

  it('expires requests after the shared TTL', () => {
    const created = Date.parse(request.createdAt)
    expect(isConnectorActionExpired(request.createdAt, created + CONNECTOR_ACTION_TTL_MS)).toBe(false)
    expect(isConnectorActionExpired(request.createdAt, created + CONNECTOR_ACTION_TTL_MS + 1)).toBe(true)
    expect(isConnectorActionExpired('not-a-date')).toBe(true)
  })

  it('validates directed delivery without an Inbox notification body', () => {
    const content = Buffer.from('# Report\n')
    const delivery = connectorArtifactDeliverySchema.parse({
      ...request,
      attachment: {
        filename: 'report.md',
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      },
    })
    expect(delivery).not.toHaveProperty('title')
    expect(delivery).not.toHaveProperty('body')
    expect(() => connectorArtifactFailureSchema.parse({
      ...request,
      reason: 'file_too_large',
      message: artifactFailureMessage('file_too_large'),
    })).not.toThrow()
    expect(() => connectorArtifactFailureSchema.parse({
      ...request,
      reason: 'nope',
      message: 'x',
    })).toThrow()
  })
})
