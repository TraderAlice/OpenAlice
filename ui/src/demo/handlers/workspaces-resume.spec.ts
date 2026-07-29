// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import {
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_MACRO_WORKSPACE_ID,
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

describe('demo Workspace resume handlers', () => {
  it('registers Issue workspaces and materializes a resumable run conversation', async () => {
    const before = await fetch(`${baseUrl}/api/workspaces`).then((response) => response.json())
    expect(before.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual(
      expect.arrayContaining([DEMO_AUTO_QUANT_WORKSPACE_ID, DEMO_MACRO_WORKSPACE_ID]),
    )

    const resumeId = 'demo-resume-morning-1'
    const url = `${baseUrl}/api/workspaces/${DEMO_AUTO_QUANT_WORKSPACE_ID}/resumes/${resumeId}/session`
    const createdResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Morning movers scan · codex' }),
    })
    const created = await createdResponse.json()

    expect(createdResponse.status).toBe(201)
    expect(created).toMatchObject({
      created: true,
      session: {
        id: `run-${resumeId}`,
        wsId: DEMO_AUTO_QUANT_WORKSPACE_ID,
        resumeId,
        agent: 'codex',
        state: 'running',
        title: 'Morning movers scan · codex',
      },
    })

    const reopenedResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A different title should not replace the durable Session' }),
    })
    expect(reopenedResponse.status).toBe(200)
    expect(await reopenedResponse.json()).toMatchObject({
      created: false,
      session: { id: `run-${resumeId}`, resumeId, title: 'Morning movers scan · codex' },
    })

    const after = await fetch(`${baseUrl}/api/workspaces`).then((response) => response.json())
    const workspace = after.workspaces.find(
      (candidate: { id: string }) => candidate.id === DEMO_AUTO_QUANT_WORKSPACE_ID,
    )
    expect(workspace.sessions).toContainEqual(expect.objectContaining({ id: `run-${resumeId}` }))
  })
})
