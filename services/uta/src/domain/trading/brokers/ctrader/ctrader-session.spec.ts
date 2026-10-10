import { describe, it, expect, vi } from 'vitest'
import { BrokerError, type BrokerConnectionStateEvent } from '../types.js'
import { PayloadType, type CtraderEnvelope } from './ctrader-protocol.js'
import { CtraderApiError, CtraderTransportError } from './ctrader-transport.js'
import { CtraderSession, toBrokerError, type CtraderSessionOptions } from './ctrader-session.js'
import { FakeCtraderServer, type FakeCtraderOptions } from './__test__/fake-ctrader-server.js'

function makeSession(
  serverOptions: FakeCtraderOptions = {},
  overrides: Partial<Omit<CtraderSessionOptions, 'transport'>> = {},
) {
  const server = new FakeCtraderServer(serverOptions)
  const states: BrokerConnectionStateEvent[] = []
  const session = new CtraderSession({
    environment: 'demo',
    account: { traderLogin: 1000001 },
    credentials: { clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1' },
    ...overrides,
    transport: { socketFactory: server.socketFactory, heartbeatIntervalMs: 0 },
  })
  session.setConnectionStateListener((e) => states.push(e))
  return { server, session, states }
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected rejection') }, (e: unknown) => e)
}

describe('CtraderSession handshake', () => {
  it('authenticates the app, resolves the account by login, then authenticates the account', async () => {
    const { server, session } = makeSession()
    await session.ensureConnected()

    expect(server.sockets[0]!.url).toBe('wss://demo.ctraderapi.com:5036')
    expect(server.received.map((m) => m.payloadType)).toEqual([
      PayloadType.APPLICATION_AUTH_REQ,
      PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
      PayloadType.ACCOUNT_AUTH_REQ,
    ])
    expect(server.received[2]!.payload).toEqual({ ctidTraderAccountId: 4242, accessToken: 'access-1' })
    expect(session.isReady).toBe(true)
    expect(session.accountRef).toEqual({
      ctidTraderAccountId: 4242, traderLogin: 1000001, brokerName: 'Spotware', isLive: false, canTrade: true,
    })
  })

  it('selects by ctidTraderAccountId when given', async () => {
    const { server, session } = makeSession(
      { accounts: [{ ctidTraderAccountId: 1, traderLogin: 11 }, { ctidTraderAccountId: 2, traderLogin: 22 }] },
      { account: { ctidTraderAccountId: 2 } },
    )
    await session.ensureConnected()
    expect(server.requestsOf(PayloadType.ACCOUNT_AUTH_REQ)[0]!.payload!['ctidTraderAccountId']).toBe(2)
    expect(session.accountRef.traderLogin).toBe(22)
  })

  it('reports a view-only token as unable to trade (numeric or named scope)', async () => {
    const numeric = makeSession({ permissionScope: 0 })
    await numeric.session.ensureConnected()
    expect(numeric.session.accountRef.canTrade).toBe(false)

    const named = makeSession()
    named.server.handlers[PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ] = (p) => ({
      payloadType: PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
      payload: { accessToken: p['accessToken'], permissionScope: 'SCOPE_TRADE', ctidTraderAccount: named.server.accounts },
    })
    await named.session.ensureConnected()
    expect(named.session.accountRef.canTrade).toBe(true)
  })

  it('rejects an unknown login with CONFIG and lists the authorized ones', async () => {
    const { session } = makeSession({}, { account: { traderLogin: 999 } })
    const err = await errorOf(session.ensureConnected())
    expect(err).toBeInstanceOf(BrokerError)
    expect(err).toMatchObject({ code: 'CONFIG' })
    expect((err as Error).message).toMatch(/login 999 is not authorized.*1000001 \(demo\)/)
  })

  it('rejects an account whose environment does not match the connection', async () => {
    const { session } = makeSession({ accounts: [{ ctidTraderAccountId: 9, traderLogin: 1000001, isLive: true }] })
    await expect(session.ensureConnected()).rejects.toMatchObject({ code: 'CONFIG', message: expect.stringMatching(/live account but the connection is set to demo/) })
  })

  it('maps wrong client credentials to a permanent AUTH error', async () => {
    const { session } = makeSession({ clientSecret: 'other' })
    const err = await errorOf(session.ensureConnected())
    expect(err).toMatchObject({ code: 'AUTH', permanent: true })
    expect((err as Error).message).toContain('CH_CLIENT_AUTH_FAILURE')
  })

  it('never sends credentials anywhere except the auth requests', async () => {
    const { server, session } = makeSession()
    server.handlers[PayloadType.TRADER_REQ] = () => ({ payloadType: PayloadType.TRADER_RES, payload: { trader: {} } })
    await session.ensureConnected()
    await session.accountRequest(PayloadType.TRADER_REQ)
    const leaked = server.received
      .filter((m) => m.payloadType !== PayloadType.APPLICATION_AUTH_REQ)
      .some((m) => JSON.stringify(m.payload).includes('client-secret'))
    expect(leaked).toBe(false)
  })

  it('requires an account selector', () => {
    expect(() => new CtraderSession({
      environment: 'demo',
      account: {},
      credentials: { clientId: 'a', clientSecret: 'b', accessToken: 'c' },
    })).toThrow(/traderLogin or ctidTraderAccountId/)
  })
})

describe('CtraderSession ensureConnected', () => {
  it('shares one in-flight attempt between concurrent callers', async () => {
    const { server, session } = makeSession()
    await Promise.all([session.ensureConnected(), session.ensureConnected(), session.ensureConnected()])
    expect(server.sockets).toHaveLength(1)
    expect(server.requestsOf(PayloadType.APPLICATION_AUTH_REQ)).toHaveLength(1)
  })

  it('is a no-op while ready', async () => {
    const { server, session } = makeSession()
    await session.ensureConnected()
    await session.ensureConnected()
    expect(server.sockets).toHaveLength(1)
  })

  it('reports CONNECTING to requests made while the handshake is in flight', async () => {
    const { server, session } = makeSession()
    server.autoOpen = false
    const connecting = session.ensureConnected()
    await expect(session.request(PayloadType.TRADER_REQ)).rejects.toMatchObject({ code: 'CONNECTING' })
    server.openPending()
    await connecting
  })

  it('reports NETWORK to requests before any connect', async () => {
    const { session } = makeSession()
    await expect(session.request(PayloadType.TRADER_REQ)).rejects.toMatchObject({ code: 'NETWORK' })
  })
})

describe('CtraderSession token refresh', () => {
  const rotating = {
    accessTokens: ['access-2'],
    refreshTokens: { 'refresh-1': { accessToken: 'access-2', refreshToken: 'refresh-2' } },
  }

  it('refreshes once on a rejected token, persists the rotated pair, and re-handshakes on a new socket', async () => {
    const persisted: unknown[] = []
    const { server, session } = makeSession(rotating, {
      credentials: { clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', refreshToken: 'refresh-1' },
      onTokensRefreshed: (t) => { persisted.push(t) },
    })
    await session.ensureConnected()

    expect(persisted).toEqual([{ accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSec: 2628000 }])
    expect(server.sockets).toHaveLength(2)
    expect(server.sockets[0]!.readyState).toBe(3)
    expect(server.requestsOf(PayloadType.ACCOUNT_AUTH_REQ).at(-1)!.payload!['accessToken']).toBe('access-2')
    expect(session.isReady).toBe(true)
    expect(session.lastTokenPersistError).toBeNull()
  })

  it('uses the rotated refresh token on the next refresh', async () => {
    const { server, session } = makeSession({
      ...rotating,
      refreshTokens: { ...rotating.refreshTokens, 'refresh-2': { accessToken: 'access-3', refreshToken: 'refresh-3' } },
    }, {
      credentials: { clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', refreshToken: 'refresh-1' },
      onTokensRefreshed: () => {},
    })
    await session.ensureConnected()
    server.accessTokens.delete('access-2')
    server.current.drop()
    await session.ensureConnected()
    expect(server.requestsOf(PayloadType.REFRESH_TOKEN_REQ).map((m) => m.payload!['refreshToken'])).toEqual(['refresh-1', 'refresh-2'])
  })

  it('stays connected but records the error when persisting fails', async () => {
    const { session } = makeSession(rotating, {
      credentials: { clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', refreshToken: 'refresh-1' },
      onTokensRefreshed: () => { throw new Error('disk full') },
    })
    await session.ensureConnected()
    expect(session.isReady).toBe(true)
    expect(session.lastTokenPersistError).toMatch(/could not be persisted: disk full/)
  })

  it('records that rotated tokens were not persisted when no store is configured', async () => {
    const { session } = makeSession(rotating, {
      credentials: { clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', refreshToken: 'refresh-1' },
    })
    await session.ensureConnected()
    expect(session.lastTokenPersistError).toMatch(/not persisted/)
  })

  it('fails with AUTH when there is no refresh token', async () => {
    const { server, session } = makeSession({ accessTokens: [] })
    await expect(session.ensureConnected()).rejects.toMatchObject({ code: 'AUTH' })
    expect(server.requestsOf(PayloadType.REFRESH_TOKEN_REQ)).toHaveLength(0)
  })

  it('refreshes at most once per attempt', async () => {
    const { server, session } = makeSession({
      accessTokens: [],
      refreshTokens: { 'refresh-1': { accessToken: 'still-bad', refreshToken: 'refresh-2' } },
    }, {
      credentials: { clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', refreshToken: 'refresh-1' },
      onTokensRefreshed: () => {},
    })
    server.handlers[PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ] = () => ({ error: 'CH_ACCESS_TOKEN_INVALID' })
    await expect(session.ensureConnected()).rejects.toMatchObject({ code: 'AUTH' })
    expect(server.requestsOf(PayloadType.REFRESH_TOKEN_REQ)).toHaveLength(1)
    expect(server.sockets).toHaveLength(2)
  })

  it('maps a rejected refresh token to AUTH', async () => {
    const { session } = makeSession({ accessTokens: [] }, {
      credentials: { clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', refreshToken: 'revoked' },
    })
    await expect(session.ensureConnected()).rejects.toMatchObject({ code: 'AUTH', message: expect.stringMatching(/token refresh/) })
  })
})

describe('CtraderSession connection loss', () => {
  it('emits dead once on a drop, stays down, then emits alive after UTA reconnects', async () => {
    const { server, session, states } = makeSession()
    const readies = vi.fn()
    session.onReady(readies)
    await session.ensureConnected()

    server.current.drop(1006, 'network')
    expect(states).toEqual([{ state: 'dead', error: 'cTrader connection lost: socket closed (1006 network)' }])
    expect(session.isReady).toBe(false)
    await expect(session.request(PayloadType.TRADER_REQ)).rejects.toMatchObject({ code: 'NETWORK' })
    expect(server.sockets).toHaveLength(1) // no self-reconnect

    await session.ensureConnected()
    expect(server.sockets).toHaveLength(2)
    expect(states.at(-1)).toEqual({ state: 'alive' })
    expect(readies).toHaveBeenCalledTimes(2)
  })

  it('goes dead when the server invalidates this account token', async () => {
    const { server, session, states } = makeSession()
    await session.ensureConnected()
    server.push(PayloadType.ACCOUNTS_TOKEN_INVALIDATED_EVENT, { ctidTraderAccountIds: [4242], reason: 'Access Token is expired' })
    expect(states).toEqual([{ state: 'dead', error: 'cTrader access token invalidated: Access Token is expired' }])
  })

  it('ignores token invalidation for other accounts', async () => {
    const { server, session, states } = makeSession()
    await session.ensureConnected()
    server.push(PayloadType.ACCOUNTS_TOKEN_INVALIDATED_EVENT, { ctidTraderAccountIds: [1] })
    expect(states).toEqual([])
    expect(session.isReady).toBe(true)
  })

  it('goes dead on client or account disconnect events', async () => {
    const client = makeSession()
    await client.session.ensureConnected()
    client.server.push(PayloadType.CLIENT_DISCONNECT_EVENT, { reason: 'blocked by administrator' })
    expect(client.states[0]).toEqual({ state: 'dead', error: 'cTrader disconnected by server: blocked by administrator' })

    const account = makeSession()
    await account.session.ensureConnected()
    account.server.push(PayloadType.ACCOUNT_DISCONNECT_EVENT, { ctidTraderAccountId: 4242 })
    expect(account.states[0]!.state).toBe('dead')
  })

  it('goes dead when a request reveals the session is no longer authorized', async () => {
    const { server, session, states } = makeSession()
    await session.ensureConnected()
    server.handlers[PayloadType.TRADER_REQ] = () => ({ error: 'ACCOUNT_NOT_AUTHORIZED' })
    const err = await errorOf(session.accountRequest(PayloadType.TRADER_REQ))
    expect(err).toBeInstanceOf(CtraderApiError)
    expect(states.map((s) => s.state)).toEqual(['dead'])
  })

  it('does not report a loss after close', async () => {
    const { session, states } = makeSession()
    await session.ensureConnected()
    await session.close()
    expect(states).toEqual([])
    await expect(session.ensureConnected()).rejects.toMatchObject({ code: 'CONFIG' })
  })
})

describe('CtraderSession requests and events', () => {
  it('fills in ctidTraderAccountId for account requests', async () => {
    const { server, session } = makeSession()
    server.handlers[PayloadType.TRADER_REQ] = (p) => ({ payloadType: PayloadType.TRADER_RES, payload: { ctidTraderAccountId: p['ctidTraderAccountId'], trader: {} } })
    await session.ensureConnected()
    const res = await session.accountRequest(PayloadType.TRADER_REQ, {}, { expect: PayloadType.TRADER_RES })
    expect(server.requestsOf(PayloadType.TRADER_REQ)[0]!.payload).toEqual({ ctidTraderAccountId: 4242 })
    expect(res.payload!['ctidTraderAccountId']).toBe(4242)
  })

  it('forwards own-account events, drops other accounts, and keeps listeners across reconnects', async () => {
    const { server, session } = makeSession()
    const events: CtraderEnvelope[] = []
    session.onEvent((m) => events.push(m))
    await session.ensureConnected()

    server.push(PayloadType.TRADER_UPDATE_EVENT, { ctidTraderAccountId: 4242 })
    server.push(PayloadType.TRADER_UPDATE_EVENT, { ctidTraderAccountId: 7 })
    server.push(PayloadType.SPOT_EVENT, { symbolId: 1 })

    server.current.drop()
    await session.ensureConnected()
    server.push(PayloadType.TRADER_UPDATE_EVENT, { ctidTraderAccountId: 4242 })

    expect(events.map((m) => [m.payloadType, m.payload!['ctidTraderAccountId'] ?? m.payload!['symbolId']])).toEqual([
      [PayloadType.TRADER_UPDATE_EVENT, 4242],
      [PayloadType.SPOT_EVENT, 1],
      [PayloadType.TRADER_UPDATE_EVENT, 4242],
    ])
  })
})

describe('toBrokerError', () => {
  const api = (errorCode: string) => new CtraderApiError(PayloadType.OA_ERROR_RES, { errorCode, description: 'x' })

  it.each([
    ['CH_CLIENT_AUTH_FAILURE', 'AUTH'],
    ['CH_ACCESS_TOKEN_INVALID', 'AUTH'],
    ['RET_ACCOUNT_DISABLED', 'AUTH'],
    ['MARKET_CLOSED', 'MARKET_CLOSED'],
    ['SYMBOL_HAS_HOLIDAY', 'MARKET_CLOSED'],
    ['BLOCKED_PAYLOAD_TYPE', 'NETWORK'],
    ['SERVER_IS_UNDER_MAINTENANCE', 'NETWORK'],
    ['ACCOUNT_NOT_AUTHORIZED', 'NETWORK'],
    ['NOT_ENOUGH_MONEY', 'EXCHANGE'],
    ['TRADING_BAD_VOLUME', 'EXCHANGE'],
  ])('maps %s to %s and keeps the venue text', (code, expected) => {
    const err = toBrokerError(api(code), 'placeOrder')
    expect(err.code).toBe(expected)
    expect(err.message).toBe(`cTrader placeOrder failed: ${code}: x`)
  })

  it('maps transport failures to NETWORK and passes BrokerError through', () => {
    expect(toBrokerError(new CtraderTransportError('Request 2121 timed out'), 'getAccount').code).toBe('NETWORK')
    const original = new BrokerError('CONFIG', 'bad')
    expect(toBrokerError(original, 'x')).toBe(original)
  })
})
