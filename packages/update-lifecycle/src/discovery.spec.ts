import { expect, it, vi } from 'vitest'
import { DiscoveryStore } from './discovery.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}
it('coalesces forced and automatic probes, including reentrant subscribers', async () => {
  const store = new DiscoveryStore<string>()
  const gate = deferred<string>()
  const read = vi.fn(() => gate.promise)
  store.subscribe(() => { if (store.getSnapshot().checking) void store.check(read, true) })
  const first = store.check(read)
  expect(store.check(read, true)).toBe(first)
  await Promise.resolve()
  expect(read).toHaveBeenCalledOnce()
  gate.resolve('release')
  expect(await first).toBe('release')
})
it('caches failures separately and preserves the last successful observation with timestamps', async () => {
  let now = 100
  const store = new DiscoveryStore<string>({ now: () => now, successTtlMs: 1000, errorTtlMs: 100 })
  await store.check(async () => 'v1')
  const read = vi.fn(async () => 'v2')
  now = 150
  expect(await store.check(read)).toBe('v1')
  expect(read).not.toHaveBeenCalled()
  now = 200
  expect(await store.check(async () => { throw new Error('offline') }, true)).toBeNull()
  expect(store.getSnapshot()).toEqual({ value: 'v1', error: 'offline', checking: false, checkedAt: 200, succeededAt: 100 })
  now = 250
  expect(await store.check(read)).toBeNull()
  expect(read).not.toHaveBeenCalled()
  now = 300
  expect(await store.check(read)).toBe('v2')
  expect(store.getSnapshot().error).toBeNull()
})
it('clearing retires old replies without clearing a replacement flight', async () => {
  const store = new DiscoveryStore<string>()
  const old = deferred<string>(), next = deferred<string>()
  const stale = store.check(() => old.promise)
  store.clear()
  const current = store.check(() => next.promise)
  old.resolve('old')
  expect(await stale).toBeNull()
  expect(store.getSnapshot().checking).toBe(true)
  expect(store.check(async () => 'duplicate')).toBe(current)
  next.resolve('new')
  expect(await current).toBe('new')
})
it('starts TTL at completion and normalizes synchronous transport errors', async () => {
  let now = 0
  const store = new DiscoveryStore<string>({ now: () => now, successTtlMs: 100 })
  const gate = deferred<string>()
  const pending = store.check(() => gate.promise)
  now = 1000
  gate.resolve('v1')
  await pending
  now = 1050
  expect(await store.check(async () => 'v2')).toBe('v1')
  await store.check(() => { throw 'failure' }, true)
  expect(store.getSnapshot().error).toBe('failure')
  await store.check(() => { throw new Error('') }, true)
  expect(store.getSnapshot().error).toBe('Discovery failed')
})
