// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import {
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_WORKSPACE_ID,
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

  it('lists Chat colleagues while the Workspace roster already contains headless Sessions', async () => {
    const response = await fetch(`${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/resumes`)
    expect(response.status).toBe(200)
    const body = await response.json() as {
      sessions: Array<{ resumeId: string; lifecycle?: string; active?: boolean; latestExecution?: { status: string } }>
    }
    expect(body.sessions.map((session) => session.resumeId)).toEqual(expect.arrayContaining([
      'demo-resume-chat',
      'resume-demo-headless-colleague',
      'resume-demo-headless-running',
      'resume-demo-archived-colleague',
      'resume-demo-headless-retired',
    ]))
    expect(body.sessions.find((session) => session.resumeId === 'resume-demo-archived-colleague'))
      .toMatchObject({ presence: 'archived' })
    expect(body.sessions.find((session) => session.resumeId === 'resume-demo-headless-colleague'))
      .toMatchObject({ active: false, latestExecution: { status: 'done' } })
    expect(body.sessions.find((session) => session.resumeId === 'resume-demo-headless-running'))
      .toMatchObject({ active: true, latestExecution: { status: 'running' } })

    const workspaces = await fetch(`${baseUrl}/api/workspaces`).then((response) => response.json())
    const chat = workspaces.workspaces.find(
      (candidate: { id: string }) => candidate.id === DEMO_CHAT_WORKSPACE_ID,
    )
    expect(chat.sessions.map((session: { resumeId: string }) => session.resumeId)).toEqual(
      expect.arrayContaining(['resume-demo-headless-colleague', 'resume-demo-headless-running']),
    )
  })

  it('replaces an idle Issue owner Session binding by resumeId', async () => {
    const list = await fetch(`${baseUrl}/api/workspaces/${DEMO_AUTO_QUANT_WORKSPACE_ID}/resumes`)
    const before = await list.json() as {
      sessions: Array<{ resumeId: string; runtime?: { model?: string; reasoningEffort?: string } }>
    }
    expect(before.sessions.find((session) => session.resumeId === 'resume-demo-thesis-owner')?.runtime)
      .toMatchObject({ credentialSource: 'native', model: 'claude-opus-4-6', reasoningEffort: 'high' })

    const response = await fetch(
      `${baseUrl}/api/workspaces/${DEMO_AUTO_QUANT_WORKSPACE_ID}/resumes/resume-demo-thesis-owner/runtime`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          credentialSource: 'native',
          model: 'claude-sonnet-4-6',
          reasoningEffort: 'low',
        }),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      resumeId: 'resume-demo-thesis-owner',
      agent: 'claude',
      runtime: {
        credentialSource: 'native',
        model: 'claude-sonnet-4-6',
        reasoningEffort: 'low',
      },
    })

    const after = await fetch(`${baseUrl}/api/workspaces/${DEMO_AUTO_QUANT_WORKSPACE_ID}/resumes`)
      .then((next) => next.json()) as typeof before
    expect(after.sessions.find((session) => session.resumeId === 'resume-demo-thesis-owner')?.runtime)
      .toMatchObject({ model: 'claude-sonnet-4-6', reasoningEffort: 'low' })
  })
})
