import { describe, expect, it, vi } from 'vitest'
import { createExecutor } from '@traderalice/opentypebb'
import { resolveCommand } from '../server/cli-commands.js'
import { createIndexTools } from './indices.js'
import { SDKIndexClient } from '../domain/market-data/client/typebb/index-client.js'
import { buildRouteMap } from '../domain/market-data/client/typebb/route-map.js'
import { getDataMany } from '../../packages/opentypebb/src/providers/fmp/utils/helpers.js'

vi.mock('../../packages/opentypebb/src/providers/fmp/utils/helpers.js', () => ({ getDataMany: vi.fn() }))
const request = vi.mocked(getDataMany)

function constituents(credentials = { fmp_api_key: 'fixture-key' }) {
  const client = new SDKIndexClient(createExecutor(), 'index', 'cboe', credentials, buildRouteMap())
  return createIndexTools(client).indexGetConstituents
}

// Exercise the registered tool through the real SDK route and provider pipeline.
describe('index constituents tool', () => {
  it('is reachable by native agents through the existing traderhub CLI export', () => {
    expect(resolveCommand('traderhub', 'index', 'constituents')).toBe('indexGetConstituents')
  })

  it.each([
    ['^GSPC', 'sp500'], [' SP500 ', 'sp500'], ['^DJI', 'dowjones'],
    ['dowjones', 'dowjones'], ['NASDAQ', 'nasdaq'],
  ])('routes %s to the FMP %s universe', async (symbol, name) => {
    request.mockResolvedValueOnce([{ symbol: 'AAPL', name: 'Apple', sector: 'Technology' }])
    const rows = await constituents().execute!({ symbol }, { toolCallId: 'fixture', messages: [] })
    expect(rows).toEqual([expect.objectContaining({ symbol: 'AAPL', name: 'Apple' })])
    expect(request).toHaveBeenLastCalledWith(`https://financialmodelingprep.com/stable/${name}-constituent/?apikey=fixture-key`)
  })

  it('rejects unsupported or ambiguous universes before a provider request', async () => {
    request.mockClear()
    for (const symbol of ['^IXIC', '^NDX', '^RUT', '', '../../other']) {
      await expect(constituents().execute!({ symbol }, { toolCallId: 'fixture', messages: [] })).rejects.toThrow()
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('preserves missing-credential and upstream errors rather than returning an empty universe', async () => {
    await expect(constituents({} as { fmp_api_key: string }).execute!({ symbol: '^GSPC' }, { toolCallId: 'fixture', messages: [] })).rejects.toThrow(/credential/i)
    request.mockRejectedValueOnce(new Error('FMP access denied'))
    await expect(constituents().execute!({ symbol: 'sp500' }, { toolCallId: 'fixture', messages: [] })).rejects.toThrow('FMP access denied')
  })
})
