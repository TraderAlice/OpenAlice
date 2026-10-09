import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createUTAClient, type GitExportState } from '@traderalice/uta-protocol'
import { UTAManagerSDK } from '../../../src/services/uta-client/UTAManagerSDK.js'
import { createTradingRoutes } from '../../../services/uta/src/http/routes-trading.js'
import { UTAManager } from '../../../services/uta/src/domain/trading/uta-manager.js'
import { FxService } from '../../../services/uta/src/domain/trading/fx-service.js'
import { UnifiedTradingAccount } from '../../../services/uta/src/domain/trading/UnifiedTradingAccount.js'
import { MockBroker } from '../../../services/uta/src/domain/trading/brokers/mock/index.js'

let root: string
let broker: MockBroker
let account: UnifiedTradingAccount
let manager: UTAManager
let server: ReturnType<typeof serve> | undefined
let port: number
let client: ReturnType<typeof createUTAClient>
let sdk: UTAManagerSDK
let readonlyMode: boolean
let requests: number
const order = { aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY' as const, orderType: 'MKT', totalQuantity: '0.3' }
const persist = async (state: GitExportState) => { await writeFile(join(root, 'wallet.json'), JSON.stringify(state)) }

async function listen(requestedPort = 0) {
  const app = new Hono()
  app.use('*', async (_, next) => { requests++; await next() })
  // UTA's production route composition, manager, trading git and broker
  // dispatcher. The only venue is an isolated in-memory MockBroker.
  app.route('/api/trading', createTradingRoutes({ utaManager: manager, fxService: new FxService() }))
  await new Promise<void>(resolve => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: requestedPort }, info => { port = info.port; resolve() }) })
}
async function stopServer() {
  if (!server) return
  const closing = server; server = undefined
  await new Promise<void>((resolve, reject) => { closing.close(error => error ? reject(error) : resolve()); if ('closeAllConnections' in closing) closing.closeAllConnections() })
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'uta-http-approval-'))
  broker = new MockBroker({ cash: 100_000 }); broker.setQuote('AAPL', 150)
  account = new UnifiedTradingAccount(broker, { onCommit: persist }); await account.waitForConnect()
  manager = new UTAManager(); manager.add(account)
  requests = 0; readonlyMode = false
  await listen()
  // Restart tests deliberately destroy the server's sockets. Keep each fixture
  // request independent so global fetch cannot reuse a stale keep-alive socket.
  client = createUTAClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2_000,
    fetch: (input, init) => fetch(input, { ...init, headers: { ...init?.headers, connection: 'close' } }),
  })
  sdk = new UTAManagerSDK({ client, readonlyMutationReason: () => readonlyMode ? 'readonly mode' : undefined })
})
afterEach(async () => {
  try { await stopServer(); await manager?.closeAll() }
  finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) }
})
async function proposal(message = 'approve local order') {
  const remote = await sdk.get('mock-paper')
  if (!remote) throw new Error('Mock UTA missing on HTTP boundary')
  await remote.stagePlaceOrder(order)
  const prepared = await remote.commit(message)
  expect(prepared.prepared).toBe(true)
  return { remote, hash: prepared.hash! }
}

it('refuses missing and stale approval hashes over real HTTP without a venue write', async () => {
  const spy = vi.spyOn(broker, 'placeOrder')
  const { remote, hash } = await proposal('first approval')
  expect(spy).not.toHaveBeenCalled()
  await expect(client.post('/api/trading/uta/mock-paper/wallet/push', {})).rejects.toMatchObject({ status: 409, body: { code: 'PENDING_HASH_REQUIRED' } })
  await remote.reject('changed my mind', hash)
  const replacement = await proposal('replacement approval')
  expect(replacement.hash).not.toBe(hash)
  await expect(remote.push(hash)).rejects.toMatchObject({ status: 409, body: { code: 'PENDING_HASH_CONFLICT' } })
  expect(spy).not.toHaveBeenCalled()
  expect(await remote.status()).toMatchObject({ pendingHash: replacement.hash })
  expect(await broker.getPositions()).toEqual([])
})

it('honors a readonly mode change after staging and server readonly policy without a venue write', async () => {
  const spy = vi.spyOn(broker, 'placeOrder')
  const { remote, hash } = await proposal()
  readonlyMode = true
  const before = requests
  await expect(remote.push(hash)).rejects.toThrow('readonly mode')
  expect(requests).toBe(before)
  // The server's independent permission guard remains authoritative even if
  // a client bypasses Alice's facade.
  const saved = account.exportGitState()
  await account.close(); manager.remove(account.id)
  account = new UnifiedTradingAccount(broker, { readOnly: true, savedState: saved })
  await account.waitForConnect(); manager.add(account)
  await remote.stagePlaceOrder(order)
  const readonlyProposal = await remote.commit('readonly server approval')
  await expect(client.post('/api/trading/uta/mock-paper/wallet/push', { expectedPendingHash: readonlyProposal.hash })).rejects.toMatchObject({ status: 500, body: { error: expect.stringMatching(/read.only/i) } })
  expect(spy).not.toHaveBeenCalled()
  expect(account.status().pendingHash).toBe(readonlyProposal.hash)
})

it('serializes duplicate HTTP approvals and refuses replay after ledger restart', async () => {
  let entered!: () => void; let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const proceed = new Promise<void>(resolve => { release = resolve })
  const original = broker.placeOrder.bind(broker)
  const spy = vi.spyOn(broker, 'placeOrder').mockImplementation(async (...args) => { entered(); await proceed; return original(...args) })
  const { remote, hash } = await proposal()
  const pending = remote.push(hash)
  try {
    await started
    await expect(remote.push(hash)).rejects.toMatchObject({ status: 409, body: { code: 'PENDING_HASH_CONFLICT' } })
  } finally { release() }
  const result = await pending
  expect(result.submitted).toHaveLength(1); expect(result.rejected).toHaveLength(0)
  expect(spy).toHaveBeenCalledTimes(1)
  expect((await broker.getPositions())[0].quantity.toFixed()).toBe('0.3')
  expect((await remote.getAccount()).totalCashValue).toBe('99955')
  const saved = JSON.parse(await readFile(join(root, 'wallet.json'), 'utf8')) as GitExportState
  await stopServer(); await account.close(); manager.remove(account.id)
  account = new UnifiedTradingAccount(broker, { savedState: saved, onCommit: persist })
  await account.waitForConnect(); manager.add(account); await listen(port)
  await expect(remote.push(hash)).rejects.toMatchObject({ status: 400 })
  expect(spy).toHaveBeenCalledTimes(1)
  expect((await remote.log()).filter(row => row.hash === hash)).toHaveLength(1)
})

it('reports transport loss and recovers the same prepared approval after HTTP reconnect', async () => {
  const spy = vi.spyOn(broker, 'placeOrder')
  const { remote, hash } = await proposal()
  await stopServer()
  await expect(remote.push(hash)).rejects.toThrow()
  expect(spy).not.toHaveBeenCalled()
  expect(account.status().pendingHash).toBe(hash)
  await listen(port)
  const result = await remote.push(hash)
  expect(result.submitted).toHaveLength(1)
  expect(spy).toHaveBeenCalledTimes(1)
})

it('preserves a venue rejection as a failed operation rather than successful submission', async () => {
  vi.spyOn(broker, 'placeOrder').mockRejectedValue(new Error('local venue rejected'))
  const { remote, hash } = await proposal()
  const result = await remote.push(hash)
  expect(result.submitted).toHaveLength(0)
  expect(result.rejected).toHaveLength(1)
  expect(result.rejected[0]).toMatchObject({ success: false, status: 'rejected', error: 'local venue rejected' })
  expect(account.status().pendingHash).toBeNull()
  expect(await broker.getPositions()).toEqual([])
  expect((await remote.getAccount()).totalCashValue).toBe('100000')
})

it('cancels a loopback read without losing the prepared approval or writing to the venue', async () => {
  const { remote, hash } = await proposal()
  const write = vi.spyOn(broker, 'placeOrder')
  const original = broker.getAccount.bind(broker)
  let entered!: () => void; let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const proceed = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(broker, 'getAccount').mockImplementationOnce(async () => { entered(); await proceed; return original() })
  const controller = new AbortController()
  const pending = client.request('GET', '/api/trading/uta/mock-paper/account', { signal: controller.signal })
  // Attach rejection observation before aborting, so the test itself cannot
  // leave an unhandled promise when an assertion fails.
  const cancelled = expect(pending).rejects.toThrow()
  try { await started; controller.abort(); await cancelled }
  finally { release() }
  expect(account.status().pendingHash).toBe(hash)
  expect(write).not.toHaveBeenCalled()
  expect((await remote.getAccount()).totalCashValue).toBe('100000')
})
