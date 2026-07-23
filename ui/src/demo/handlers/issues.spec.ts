// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { issuesHandlers } from './issues'

const server = setupServer(...issuesHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('demo Issue handlers', () => {
  it('round-trips model and effort patches through the detail contract', async () => {
    const response = await fetch(
      `${baseUrl}/api/issues/demo-ws-auto-quant/morning-scan`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.5', effort: 'high' }),
      },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.issue).toMatchObject({
      id: 'morning-scan',
      model: 'gpt-5.5',
      effort: 'high',
    })
  })
})
