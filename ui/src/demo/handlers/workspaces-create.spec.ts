// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { resetDemoWorkspaceCreateState, workspacesHandlers } from './workspaces'

const server = setupServer(...workspacesHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDemoWorkspaceCreateState()
})
afterAll(() => server.close())

async function createWorkspace(tag: string, template = 'chat') {
  return fetch(`${baseUrl}/api/workspaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag, template }),
  })
}

describe('demo Workspace creation handler', () => {
  it('creates an in-memory Workspace and includes it in later list responses', async () => {
    const response = await createWorkspace('chat-jul29')
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.workspace).toMatchObject({
      id: 'demo-created-ws-1',
      tag: 'chat-jul29',
      dir: '/demo/workspaces/chat-jul29',
      template: 'chat',
      spawnedFromVersion: '0.2.0',
      currentVersion: '0.2.0',
      upgradeAvailable: null,
      sessions: [],
    })

    const list = await fetch(`${baseUrl}/api/workspaces`).then((result) => result.json())
    expect(list.workspaces).toContainEqual(body.workspace)
  })

  it('returns the production error shape for duplicate tags', async () => {
    expect((await createWorkspace('chat-jul29')).status).toBe(201)

    const duplicate = await createWorkspace('chat-jul29')
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({
      error: 'tag_in_use',
      message: 'A Workspace with tag "chat-jul29" already exists.',
    })
  })

  it('rejects invalid tags without nesting the renderable error', async () => {
    const response = await createWorkspace('Invalid Tag')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'invalid_tag',
      message: 'Use a-z, 0-9, "-", or "_"; start with a letter or number; maximum 33 characters.',
    })
  })
})
