import { describe, expect, it, vi } from 'vitest'
import { SnapTradeApiError, SnapTradeClient, signSnapTradeRequest } from './snaptrade-client.js'

describe('SnapTradeClient', () => {
  it('signs canonical nested request data with the Personal consumer key', () => {
    const signature = signSnapTradeRequest({
      path: '/api/v1/example',
      query: 'clientId=client&timestamp=1',
      content: { z: 1, a: { y: 2, b: 3 } },
    }, 'secret')

    expect(signature).toBe(signSnapTradeRequest({
      path: '/api/v1/example',
      query: 'clientId=client&timestamp=1',
      content: { a: { b: 3, y: 2 }, z: 1 },
    }, 'secret'))
  })

  it('sends Personal credentials only as clientId plus a request signature', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }))
    const client = new SnapTradeClient({ clientId: 'client id', consumerKey: 'secret' }, fetchImpl, () => 1_700_000_000_000)

    await expect(client.get('/accounts', [['broker', 'ROBINHOOD']])).resolves.toEqual({ results: [] })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.snaptrade.com/accounts?broker=ROBINHOOD&clientId=client%20id&timestamp=1700000000',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Accept: 'application/json', Signature: expect.any(String) }),
      }),
    )
  })

  it('preserves provider request IDs in failures without logging credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('disabled', {
      status: 403,
      headers: { 'x-request-id': 'request-123' },
    }))
    const client = new SnapTradeClient({ clientId: 'client', consumerKey: 'secret' }, fetchImpl, () => 1_700_000_000_000)

    await expect(client.get('/accounts')).rejects.toEqual(expect.objectContaining<SnapTradeApiError>({
      status: 403,
      requestId: 'request-123',
    }))
  })
})
