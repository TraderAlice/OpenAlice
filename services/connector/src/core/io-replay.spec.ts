import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { parseConnectorIOJsonl, replayConnectorNotifications } from './io-replay.js'

describe('Connector I/O replay smoke', () => {
  it('replays recorded ingress once and ignores recorded result evidence', async () => {
    const fixture = await readFile(new URL('../../test-fixtures/io-smoke.jsonl', import.meta.url), 'utf8')
    const events = parseConnectorIOJsonl(fixture)
    const deliver = vi.fn(async () => undefined)

    await expect(replayConnectorNotifications(events, deliver)).resolves.toBe(1)
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      id: 'inbox-fixture-1',
      title: 'Recorded connector smoke',
    }))
  })

  it('fails loud when a received payload is not replayable', async () => {
    const events = parseConnectorIOJsonl('{"version":1,"eventId":"e","at":"now","correlationId":"c","direction":"inbound","stage":"notification.received","payload":{}}\n')
    await expect(replayConnectorNotifications(events, async () => undefined)).rejects.toThrow(/not replayable/)
  })
})
