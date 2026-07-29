// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { resetDemoToolsState, toolsSimulatorHandlers } from './toolsSimulator'

const server = setupServer(...toolsSimulatorHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDemoToolsState()
})
afterAll(() => server.close())

describe('demo tool handlers', () => {
  it('returns a representative catalog with runnable examples', async () => {
    const inventoryResponse = await fetch(`${baseUrl}/api/tools`)
    const inventory = await inventoryResponse.json()

    expect(inventoryResponse.status).toBe(200)
    expect(inventory.inventory.map((tool: { name: string }) => tool.name)).toEqual([
      'calculate',
      'marketSearchForResearch',
      'searchBars',
      'equityGetProfile',
    ])
    expect(inventory.disabled).toEqual([])

    const detailResponse = await fetch(`${baseUrl}/api/tools/searchBars`)
    const detail = await detailResponse.json()

    expect(detailResponse.status).toBe(200)
    expect(detail).toMatchObject({
      name: 'searchBars',
      group: 'quant',
      inputSchema: {
        required: ['query'],
        examples: [{ query: 'AAPL' }],
      },
    })
  })

  it('returns a recorded result with the submitted input', async () => {
    const response = await fetch(`${baseUrl}/api/tools/equityGetProfile/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: 'AAPL' }),
    })
    const body = await response.json()
    const result = JSON.parse(body.content[0].text)

    expect(response.status).toBe(200)
    expect(result).toMatchObject({
      demo: true,
      note: expect.stringContaining('Recorded result'),
      input: { symbol: 'AAPL' },
      result: {
        profile: {
          symbol: 'AAPL',
          name: 'Apple Inc.',
        },
      },
    })
  })

  it('round-trips disabled tool state and rejects unknown tools', async () => {
    const updateResponse = await fetch(`${baseUrl}/api/tools`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        disabled: ['searchBars', 'missingTool'],
      }),
    })

    expect(await updateResponse.json()).toEqual({ disabled: ['searchBars'] })
    expect(await fetch(`${baseUrl}/api/tools`).then((result) => result.json())).toMatchObject({
      disabled: ['searchBars'],
    })

    const missing = await fetch(`${baseUrl}/api/tools/missingTool`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Tool not found: missingTool' })
  })
})
