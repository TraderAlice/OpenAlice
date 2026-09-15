import { Hono } from 'hono'
import { tool } from 'ai'
import { z } from 'zod'
import { expect, it, vi } from 'vitest'
import { registerMarketReferenceRoute } from './market-reference.js'
import type { ToolCenter } from '../core/tool-center.js'
it('only dispatches bounded market reads, keeping the native key intact', async () => {
  const execute = vi.fn(async () => ({ bars: [], meta: {} }))
  const get = vi.fn(() => tool({ inputSchema: z.object({}), execute }))
  const app = new Hono(); registerMarketReferenceRoute(app, { get } as unknown as ToolCenter)
  const response = await app.request(`/cli/market-reference?${new URLSearchParams({ reference: 'market/okx|BTC/USDT:USDT/1h' })}`)
  expect(response.status).toBe(200)
  expect(get).toHaveBeenCalledWith('getMarketBars')
  expect(execute).toHaveBeenCalledWith({ barId: 'okx|BTC/USDT:USDT', interval: '1h', count: 300 }, expect.anything())
  expect((await app.request('/cli/market-reference?reference=sticker/a.png')).status).toBe(400)
  expect(execute).toHaveBeenCalledOnce()
})
