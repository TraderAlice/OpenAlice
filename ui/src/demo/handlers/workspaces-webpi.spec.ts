// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import {
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
  DEMO_SESSION_ID,
  DEMO_WORKSPACE_ID,
} from '../fixtures/workspaces'
import { resetDemoWorkspaceWebPiState, workspacesHandlers } from './workspaces'

const server = setupServer(...workspacesHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDemoWorkspaceWebPiState()
})
afterAll(() => server.close())

describe('demo WebPi Session handlers', () => {
  it('serves each featured Session with its own recorded native Pi transcript', async () => {
    const semisResponse = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/sessions/${DEMO_CHAT_SESSION_ID}/webpi`,
    )
    const aaplResponse = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_WORKSPACE_ID}/sessions/${DEMO_SESSION_ID}/webpi`,
    )
    const semis = await semisResponse.json()
    const aapl = await aaplResponse.json()

    expect(semisResponse.status).toBe(200)
    expect(semis.snapshot).toMatchObject({
      wsId: DEMO_CHAT_WORKSPACE_ID,
      recordId: DEMO_CHAT_SESSION_ID,
      phase: 'idle',
    })
    expect(JSON.stringify(semis.snapshot.messages)).toContain('semiconductors')

    expect(aaplResponse.status).toBe(200)
    expect(aapl.snapshot).toMatchObject({
      wsId: DEMO_WORKSPACE_ID,
      recordId: DEMO_SESSION_ID,
      phase: 'idle',
    })
    expect(JSON.stringify(aapl.snapshot.messages)).toContain('Services growth decelerating')
  })

  it('honors revisions and scopes simulated follow-ups to the selected Session', async () => {
    const first = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/sessions/${DEMO_CHAT_SESSION_ID}/webpi`,
    ).then((response) => response.json())

    const unchanged = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/sessions/${DEMO_CHAT_SESSION_ID}/webpi?revision=${first.snapshot.revision}`,
    )
    expect(await unchanged.json()).toEqual({ unchanged: true })

    const followUp = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/sessions/${DEMO_CHAT_SESSION_ID}/webpi/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'What would confirm the move?' }),
      },
    ).then((response) => response.json())

    expect(followUp.snapshot.revision).toBe(first.snapshot.revision + 1)
    expect(followUp.snapshot.messages).toHaveLength(first.snapshot.messages.length + 2)
    expect(JSON.stringify(followUp.snapshot.messages)).toContain('public preview does not call a live model')

    const aapl = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_WORKSPACE_ID}/sessions/${DEMO_SESSION_ID}/webpi`,
    ).then((response) => response.json())
    expect(JSON.stringify(aapl.snapshot.messages)).not.toContain('What would confirm the move?')
  })

  it('creates a durable in-memory WebPi Session when demo Quick Chat launches Pi', async () => {
    const response = await fetch(`${baseUrl}/api/workspaces/quick-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Map the next confirmation signals.',
        agent: 'pi',
        targetWsId: DEMO_CHAT_WORKSPACE_ID,
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.session).toMatchObject({ agent: 'pi', surface: 'webpi' })
    expect(body.workspace.sessions.some((session: { id: string }) => session.id === body.session.sessionId)).toBe(true)

    const snapshotResponse = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/sessions/${body.session.sessionId}/webpi`,
    )
    const snapshot = await snapshotResponse.json()
    expect(snapshotResponse.status).toBe(200)
    expect(snapshot.snapshot.recordId).toBe(body.session.sessionId)
    expect(JSON.stringify(snapshot.snapshot.messages)).toContain('Map the next confirmation signals.')

    const workspaceList = await fetch(`${baseUrl}/api/workspaces`).then((result) => result.json())
    const chatWorkspace = workspaceList.workspaces.find(
      (workspace: { id: string }) => workspace.id === DEMO_CHAT_WORKSPACE_ID,
    )
    expect(chatWorkspace.sessions.some((session: { id: string }) => session.id === body.session.sessionId)).toBe(true)
  })
})
