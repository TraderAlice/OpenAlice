// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import packageJson from '../../../../package.json'
import { devMiscHandlers } from './devMisc'

const server = setupServer(...devMiscHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('demo version handlers', () => {
  it.each([
    ['GET', '/api/version'],
    ['POST', '/api/version/check'],
  ])('returns the checked-in application version for %s %s', async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, { method })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.current).toBe(packageJson.version)
  })
})
