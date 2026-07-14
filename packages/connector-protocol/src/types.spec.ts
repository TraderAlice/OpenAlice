import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_CONNECTOR_ATTACHMENT_BYTES,
  inboxNotificationSchema,
} from './types.js'

const baseNotification = {
  id: 'inbox-1',
  createdAt: '2026-07-13T00:00:00.000Z',
  workspaceId: 'ws-1',
  title: 'Report ready',
  body: '',
}

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
