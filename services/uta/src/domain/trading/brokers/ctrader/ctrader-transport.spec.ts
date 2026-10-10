import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CtraderApiError,
  CtraderTransport,
  CtraderTransportError,
  type WebSocketLike,
} from './ctrader-transport.js'
import { PayloadType, ctraderJsonUrl, type CtraderEnvelope } from './ctrader-protocol.js'

// ==================== fake socket ====================

class FakeSocket implements WebSocketLike {
  readyState = 0
  sent: CtraderEnvelope[] = []
  closeCalls = 0
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as CtraderEnvelope)
  }

  close(): void {
    this.closeCalls++
    this.readyState = 3
  }

  // ---- server side ----
  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }

  reply(message: CtraderEnvelope | string): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) })
  }

  drop(code = 1006, reason = ''): void {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }

  lastSent(): CtraderEnvelope {
    const last = this.sent[this.sent.length - 1]
    if (!last) throw new Error('nothing sent')
    return last
  }
}

function setup(options: { heartbeatIntervalMs?: number; requestTimeoutMs?: number } = {}) {
  let socket: FakeSocket | null = null
  const transport = new CtraderTransport({
    url: 'wss://example.test:5036',
    socketFactory: (url) => (socket = new FakeSocket(url)),
    connectTimeoutMs: 1_000,
    requestTimeoutMs: options.requestTimeoutMs ?? 1_000,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 0,
  })
  return { transport, socket: () => socket! }
}

async function connected(options?: Parameters<typeof setup>[0]) {
  const ctx = setup(options)
  const connecting = ctx.transport.connect()
  ctx.socket().open()
  await connecting
  return ctx
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

// ==================== tests ====================

describe('ctraderJsonUrl', () => {
  it('targets the JSON port of each environment', () => {
    expect(ctraderJsonUrl('demo')).toBe('wss://demo.ctraderapi.com:5036')
    expect(ctraderJsonUrl('live')).toBe('wss://live.ctraderapi.com:5036')
  })
})

describe('CtraderTransport connect', () => {
  it('resolves when the socket opens', async () => {
    const { transport, socket } = await connected()
    expect(socket().url).toBe('wss://example.test:5036')
    expect(transport.isOpen).toBe(true)
  })

  it('rejects when the socket closes before opening', async () => {
    const { transport, socket } = setup()
    const connecting = transport.connect()
    socket().drop(1006)
    await expect(connecting).rejects.toBeInstanceOf(CtraderTransportError)
    expect(transport.isOpen).toBe(false)
  })

  it('rejects and closes the socket on connect timeout', async () => {
    const { transport, socket } = setup()
    const connecting = transport.connect()
    const assertion = expect(connecting).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(socket().closeCalls).toBe(1)
  })

  it('refuses to connect twice', async () => {
    const { transport } = await connected()
    await expect(transport.connect()).rejects.toThrow(/already used/)
  })
})

describe('CtraderTransport request', () => {
  it('correlates replies by clientMsgId, not by arrival order', async () => {
    const { transport, socket } = await connected()
    const first = transport.request(PayloadType.TRADER_REQ, { ctidTraderAccountId: 1 })
    const second = transport.request(PayloadType.RECONCILE_REQ, { ctidTraderAccountId: 1 })
    const [a, b] = socket().sent
    expect(a!.clientMsgId).not.toBe(b!.clientMsgId)

    socket().reply({ clientMsgId: b!.clientMsgId, payloadType: PayloadType.RECONCILE_RES, payload: { position: [] } })
    socket().reply({ clientMsgId: a!.clientMsgId, payloadType: PayloadType.TRADER_RES, payload: { trader: {} } })

    await expect(first).resolves.toMatchObject({ payloadType: PayloadType.TRADER_RES })
    await expect(second).resolves.toMatchObject({ payloadType: PayloadType.RECONCILE_RES, payload: { position: [] } })
  })

  it('sends the documented JSON envelope', async () => {
    const { transport, socket } = await connected()
    void transport.request(PayloadType.VERSION_REQ)
    expect(socket().lastSent()).toEqual({ clientMsgId: expect.any(String), payloadType: PayloadType.VERSION_REQ, payload: {} })
  })

  it('rejects OA error replies with the venue error code and text', async () => {
    const { transport, socket } = await connected()
    const req = transport.request(PayloadType.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: 7, accessToken: 'x' })
    socket().reply({
      clientMsgId: socket().lastSent().clientMsgId,
      payloadType: PayloadType.OA_ERROR_RES,
      payload: { errorCode: 'CH_ACCESS_TOKEN_INVALID', description: 'Access token expired' },
    })
    const err = await req.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CtraderApiError)
    expect(err).toMatchObject({ errorCode: 'CH_ACCESS_TOKEN_INVALID', transient: false })
    expect((err as Error).message).toContain('Access token expired')
  })

  it('marks rate-limit and routing errors transient', async () => {
    const { transport, socket } = await connected()
    const req = transport.request(PayloadType.GET_TRENDBARS_REQ)
    socket().reply({ clientMsgId: socket().lastSent().clientMsgId, payloadType: PayloadType.ERROR_RES, payload: { errorCode: 'BLOCKED_PAYLOAD_TYPE' } })
    await expect(req).rejects.toMatchObject({ errorCode: 'BLOCKED_PAYLOAD_TYPE', transient: true })
  })

  it('rejects a reply of an unexpected type when expect is given', async () => {
    const { transport, socket } = await connected()
    const req = transport.request(PayloadType.TRADER_REQ, {}, { expect: PayloadType.TRADER_RES })
    socket().reply({ clientMsgId: socket().lastSent().clientMsgId, payloadType: PayloadType.RECONCILE_RES })
    await expect(req).rejects.toThrow(/Unexpected reply/)
  })

  it('accepts any of several expected reply types', async () => {
    const { transport, socket } = await connected()
    const req = transport.request(PayloadType.NEW_ORDER_REQ, {}, {
      expect: [PayloadType.EXECUTION_EVENT, PayloadType.ORDER_ERROR_EVENT],
    })
    socket().reply({ clientMsgId: socket().lastSent().clientMsgId, payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { errorCode: 'NOT_ENOUGH_MONEY' } })
    await expect(req).resolves.toMatchObject({ payloadType: PayloadType.ORDER_ERROR_EVENT })
  })

  it('times out a request that never gets a reply', async () => {
    const { transport } = await connected({ requestTimeoutMs: 500 })
    const req = transport.request(PayloadType.TRADER_REQ)
    const assertion = expect(req).rejects.toThrow(/timed out after 500ms/)
    await vi.advanceTimersByTimeAsync(500)
    await assertion
  })

  it('rejects immediately when not connected', async () => {
    const { transport } = setup()
    await expect(transport.request(PayloadType.TRADER_REQ)).rejects.toThrow(/Not connected/)
  })

  it('rejects every pending request when the socket drops', async () => {
    const { transport, socket } = await connected()
    const a = transport.request(PayloadType.TRADER_REQ)
    const b = transport.request(PayloadType.RECONCILE_REQ)
    socket().drop(1006, 'gone')
    await expect(a).rejects.toThrow(/Connection closed: socket closed \(1006 gone\)/)
    await expect(b).rejects.toBeInstanceOf(CtraderTransportError)
    await expect(transport.request(PayloadType.TRADER_REQ)).rejects.toThrow(/Not connected: socket closed/)
  })
})

describe('CtraderTransport events', () => {
  it('forwards unsolicited messages and swallows heartbeats', async () => {
    const { transport, socket } = await connected()
    const events: CtraderEnvelope[] = []
    transport.onEvent((m) => events.push(m))

    socket().reply({ payloadType: PayloadType.HEARTBEAT_EVENT })
    socket().reply({ payloadType: PayloadType.SPOT_EVENT, payload: { symbolId: 1, bid: 112016 } })

    expect(events).toEqual([{ payloadType: PayloadType.SPOT_EVENT, payload: { symbolId: 1, bid: 112016 } }])
  })

  it('never settles a request with an event type, even with a matching id', async () => {
    const { transport, socket } = await connected()
    const events: CtraderEnvelope[] = []
    transport.onEvent((m) => events.push(m))
    const req = transport.request(PayloadType.SUBSCRIBE_SPOTS_REQ)
    const id = socket().lastSent().clientMsgId

    socket().reply({ clientMsgId: id, payloadType: PayloadType.SPOT_EVENT, payload: {} })
    expect(events).toHaveLength(1)

    socket().reply({ clientMsgId: id, payloadType: PayloadType.SUBSCRIBE_SPOTS_RES })
    await expect(req).resolves.toMatchObject({ payloadType: PayloadType.SUBSCRIBE_SPOTS_RES })
  })

  it('settles the order request and also broadcasts its execution event', async () => {
    const { transport, socket } = await connected()
    const events: CtraderEnvelope[] = []
    transport.onEvent((m) => events.push(m))
    const req = transport.request(PayloadType.NEW_ORDER_REQ)
    const reply = { clientMsgId: socket().lastSent().clientMsgId, payloadType: PayloadType.EXECUTION_EVENT, payload: { executionType: 'ORDER_ACCEPTED' } }

    socket().reply(reply)
    await expect(req).resolves.toEqual(reply)
    expect(events).toEqual([reply])
  })

  it('ignores malformed frames', async () => {
    const { transport, socket } = await connected()
    const events: CtraderEnvelope[] = []
    transport.onEvent((m) => events.push(m))
    socket().reply('not json')
    socket().reply('{"payload":{}}')
    socket().onmessage?.({ data: new Uint8Array([1, 2]) })
    expect(events).toEqual([])
  })

  it('keeps delivering when one listener throws', async () => {
    const { transport, socket } = await connected()
    const seen: number[] = []
    transport.onEvent(() => { throw new Error('boom') })
    transport.onEvent((m) => seen.push(m.payloadType))
    socket().reply({ payloadType: PayloadType.TRADER_UPDATE_EVENT })
    expect(seen).toEqual([PayloadType.TRADER_UPDATE_EVENT])
  })

  it('notifies close listeners once, including late subscribers', async () => {
    const { transport, socket } = await connected()
    const reasons: string[] = []
    transport.onClose((r) => reasons.push(r))
    socket().drop(1000)
    transport.close()
    transport.onClose((r) => reasons.push(`late:${r}`))
    expect(reasons).toEqual(['socket closed (1000)', 'late:socket closed (1000)'])
  })
})

describe('CtraderTransport heartbeat', () => {
  it('sends heartbeats on the interval and stops after close', async () => {
    const { transport, socket } = await connected({ heartbeatIntervalMs: 10_000 })
    await vi.advanceTimersByTimeAsync(25_000)
    const beats = socket().sent.filter((m) => m.payloadType === PayloadType.HEARTBEAT_EVENT)
    expect(beats).toHaveLength(2)
    expect(beats[0]).toEqual({ payloadType: PayloadType.HEARTBEAT_EVENT })

    transport.close()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(socket().sent.filter((m) => m.payloadType === PayloadType.HEARTBEAT_EVENT)).toHaveLength(2)
    expect(socket().closeCalls).toBe(1)
  })
})
