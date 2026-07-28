// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import type { HeadlessListSnapshot } from '../../api/headless'
import { demoWorkspaces } from '../fixtures/workspaces'
import { headlessHandlers } from './headless'

const server = setupServer(...headlessHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('demo headless handlers', () => {
  it('ties every run to a registered demo Workspace', async () => {
    const response = await fetch(`${baseUrl}/api/headless`)
    const body = await response.json() as HeadlessListSnapshot
    const workspaceIds = new Set(demoWorkspaces.map((workspace) => workspace.id))

    expect(response.status).toBe(200)
    expect(body.tasks.length).toBeGreaterThan(0)
    expect(body.tasks.every((task) => workspaceIds.has(task.wsId))).toBe(true)
  })
})
