// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { DEMO_WORKSPACE_ID } from '../fixtures/workspaces'
import { inquiryHandlers, resetDemoInquiryState } from './inquiries'

const server = setupServer(...inquiryHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDemoInquiryState()
})
afterAll(() => server.close())

async function askInbox(entryId: string) {
  const response = await fetch(`${baseUrl}/api/inquiries/inbox/${entryId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Which assumption is driving the result?' }),
  })

  return { response, body: await response.json() }
}

describe('demo Inquiry handlers', () => {
  it('continues the known Codex Inbox sender in the original Workspace', async () => {
    const { response, body } = await askInbox('demo-inbox-headless-session')

    expect(response.status).toBe(202)
    expect(body).toMatchObject({
      status: 'dispatched',
      workspaceId: DEMO_WORKSPACE_ID,
      workspace: 'demo',
      agent: 'codex',
      resolution: { mode: 'exact' },
    })

    const history = await fetch(
      `${baseUrl}/api/inquiries/inbox/demo-inbox-headless-session`,
    ).then((result) => result.json())
    expect(history.inquiries).toEqual([
      expect.objectContaining({
        workspaceId: DEMO_WORKSPACE_ID,
        agent: 'codex',
        inquiry: expect.objectContaining({
          question: 'Which assumption is driving the result?',
          resolution: { mode: 'exact' },
        }),
      }),
    ])
  })

  it('preserves the interactive Claude sender label', async () => {
    const { body } = await askInbox('demo-inbox-aapl-q1')

    expect(body).toMatchObject({
      workspaceId: DEMO_WORKSPACE_ID,
      workspace: 'demo',
      agent: 'claude',
    })
  })

  it('preserves the source Workspace identity for scheduled Inbox reports', async () => {
    const { body } = await askInbox('demo-inbox-morning-1')

    expect(body).toMatchObject({
      workspaceId: 'demo-ws-auto-quant',
      workspace: 'auto-quant',
      agent: 'codex',
    })
  })
})
