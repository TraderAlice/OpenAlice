import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ConnectorClient } from './client.js'

describe('ConnectorClient inbound return', () => {
  it('posts drained owner messages back to the connector queue', async () => {
    const fetchImpl = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe('/v1/inbound/return')
      expect(JSON.parse(String(init?.body))).toEqual({
        messages: [{ connectorId: 'telegram', userId: '1', text: 'Hold this' }],
      })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const client = new ConnectorClient('http://127.0.0.1:47334', fetchImpl)
    await client.returnInbound([{ connectorId: 'telegram', userId: '1', text: 'Hold this' }])
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe('ConnectorClient artifact control plane', () => {
  it('drains only schema-valid artifact requests and ignores a raw path field', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      requests: [
        {
          requestId: 'art-1',
          connectorId: 'telegram',
          entryId: 'entry-1',
          docIndex: 0,
          createdAt: '2026-08-14T15:02:00.000Z',
          path: '/etc/passwd',
        },
        { requestId: '', connectorId: 'telegram', entryId: 'bad', docIndex: 0 },
      ],
    }), { status: 200 }))
    const client = new ConnectorClient('http://127.0.0.1:47334', fetchImpl)
    const requests = await client.drainActions()
    expect(requests).toEqual([{
      requestId: 'art-1',
      connectorId: 'telegram',
      entryId: 'entry-1',
      docIndex: 0,
      createdAt: '2026-08-14T15:02:00.000Z',
    }])
    expect(requests[0]).not.toHaveProperty('path')
  })

  it('drains only schema-valid UTA requests and ignores extra fields', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      requests: [
        {
          requestId: 'uta-1',
          connectorId: 'telegram',
          createdAt: '2026-08-14T15:02:00.000Z',
          action: 'push',
          utaId: 'alpaca-paper',
          pendingHash: 'abc12345',
          reason: 'should-not-round-trip',
        },
        { requestId: 'uta-bad', connectorId: 'telegram', createdAt: '2026-08-14T15:02:00.000Z', action: 'explode' },
      ],
    }), { status: 200 }))
    const client = new ConnectorClient('http://127.0.0.1:47334', fetchImpl)
    const requests = await client.drainUtaActions()
    expect(requests).toEqual([{
      requestId: 'uta-1',
      connectorId: 'telegram',
      createdAt: '2026-08-14T15:02:00.000Z',
      action: 'push',
      utaId: 'alpaca-paper',
      pendingHash: 'abc12345',
    }])
    expect(requests[0]).not.toHaveProperty('reason')
  })

  it('posts a directed artifact delivery without an Inbox notification body', async () => {
    const content = Buffer.from('# Close\n')
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).not.toHaveProperty('title')
      expect(body).not.toHaveProperty('body')
      expect(body).toMatchObject({
        requestId: 'art-1',
        connectorId: 'telegram',
        entryId: 'entry-1',
        docIndex: 0,
      })
      return new Response(JSON.stringify({ accepted: true, deliveryId: 'art-1' }), { status: 202 })
    })
    const client = new ConnectorClient('http://127.0.0.1:47334', fetchImpl)
    await expect(client.deliverArtifact({
      requestId: 'art-1',
      connectorId: 'telegram',
      entryId: 'entry-1',
      docIndex: 0,
      attachment: {
        filename: 'close.md',
        mediaType: 'text/markdown',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      },
    })).resolves.toEqual({ accepted: true, deliveryId: 'art-1' })
  })
})
