import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectorWorkQueue } from './work-queue.js'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(now: { value: number }, leaseMs = 100) {
  const home = await mkdtemp(join(tmpdir(), 'connector-work-queue-'))
  homes.push(home)
  const path = join(home, 'queue.json')
  return { path, queue: new ConnectorWorkQueue({ path, now: () => now.value, leaseMs }) }
}

describe('ConnectorWorkQueue', () => {
  it('persists before claim and recovers unacked work after lease expiry', async () => {
    const now = { value: 1_000 }
    const { path, queue } = await fixture(now)
    await queue.enqueue('inbound', 'event-1', { text: 'private hello' })

    const first = await queue.claim<{ text: string }>('inbound', 10)
    expect(first.items).toEqual([{ id: 'event-1', payload: { text: 'private hello' } }])
    expect((await new ConnectorWorkQueue({ path, now: () => now.value, leaseMs: 100 })
      .claim('inbound', 10)).items).toEqual([])

    now.value += 101
    const restarted = new ConnectorWorkQueue({ path, now: () => now.value, leaseMs: 100 })
    const recovered = await restarted.claim<{ text: string }>('inbound', 10)
    expect(recovered.items.map((item) => item.id)).toEqual(['event-1'])
    await restarted.ack(recovered.claimId, ['event-1'])
    now.value += 101
    expect((await restarted.claim('inbound', 10)).items).toEqual([])
    expect(await readFile(path, 'utf8')).not.toContain('private hello')
  })

  it('releases selected work immediately and keeps ack idempotent', async () => {
    const now = { value: 1_000 }
    const { queue } = await fixture(now)
    await queue.enqueue('artifact', 'a', { value: 1 })
    await queue.enqueue('artifact', 'b', { value: 2 })
    const claim = await queue.claim('artifact', 10)
    await queue.ack(claim.claimId, ['a'])
    await queue.ack(claim.claimId, ['a'])
    await queue.release(claim.claimId, ['b'])
    expect((await queue.claim('artifact', 10)).items.map((item) => item.id)).toEqual(['b'])
  })

  it('deduplicates stable ids and rejects overflow without dropping older work', async () => {
    const now = { value: 1_000 }
    const { path } = await fixture(now)
    const limited = new ConnectorWorkQueue({
      path,
      now: () => now.value,
      limits: { inbound: 1 },
    })
    await limited.enqueue('inbound', 'same', { text: 'first' })
    await limited.enqueue('inbound', 'same', { text: 'duplicate' })
    await expect(limited.enqueue('inbound', 'next', { text: 'next' })).rejects.toThrow('queue is full')
    expect((await limited.claim<{ text: string }>('inbound', 10)).items[0]?.payload.text).toBe('first')
  })

  it('rejects an unsealed persisted queue', async () => {
    const now = { value: 1_000 }
    const { path } = await fixture(now)
    await writeFile(path, JSON.stringify({ version: 1, entries: [] }))
    await expect(new ConnectorWorkQueue({ path }).claim('inbound', 10))
      .rejects.toThrow('not a sealed envelope')
  })
})
