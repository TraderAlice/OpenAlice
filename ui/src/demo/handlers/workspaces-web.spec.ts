// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import {
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
  DEMO_SESSION_ID,
  DEMO_WORKSPACE_ID,
} from '../fixtures/workspaces'
import { resetDemoWorkspaceWebState, workspacesHandlers } from './workspaces'

const server = setupServer(...workspacesHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDemoWorkspaceWebState()
})
afterAll(() => server.close())

const webUrl = (wsId: string, sessionId: string, tail = '') =>
  `${baseUrl}/api/workspaces/${wsId}/sessions/${sessionId}/web${tail}`

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}

async function quickChat(agent: string, prompt: string) {
  const { status, body } = await postJson(`${baseUrl}/api/workspaces/quick-chat`, {
    prompt,
    agent,
    targetWsId: DEMO_CHAT_WORKSPACE_ID,
  })
  expect(status).toBe(201)
  return body
}

describe('demo Web Session handlers', () => {
  it('serves each featured Session with its own recorded transcript in the neutral shape', async () => {
    const semisResponse = await fetch(webUrl(DEMO_CHAT_WORKSPACE_ID, DEMO_CHAT_SESSION_ID))
    const aaplResponse = await fetch(webUrl(DEMO_WORKSPACE_ID, DEMO_SESSION_ID))
    const semis = await semisResponse.json()
    const aapl = await aaplResponse.json()

    expect(semisResponse.status).toBe(200)
    expect(semis.snapshot).toMatchObject({
      wsId: DEMO_CHAT_WORKSPACE_ID,
      recordId: DEMO_CHAT_SESSION_ID,
      agent: 'pi',
      wire: 'pi-rpc',
      phase: 'idle',
      requests: [],
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
    const first = await fetch(webUrl(DEMO_CHAT_WORKSPACE_ID, DEMO_CHAT_SESSION_ID)).then((response) => response.json())

    const unchanged = await fetch(
      webUrl(DEMO_CHAT_WORKSPACE_ID, DEMO_CHAT_SESSION_ID, `?revision=${first.snapshot.revision}`),
    )
    expect(await unchanged.json()).toEqual({ unchanged: true, revision: first.snapshot.revision })

    const followUp = await postJson(
      webUrl(DEMO_CHAT_WORKSPACE_ID, DEMO_CHAT_SESSION_ID, '/prompt'),
      { message: 'What would confirm the move?' },
    )

    expect(followUp.body.snapshot.revision).toBe(first.snapshot.revision + 1)
    expect(followUp.body.snapshot.messages).toHaveLength(first.snapshot.messages.length + 2)
    expect(JSON.stringify(followUp.body.snapshot.messages)).toContain('public preview does not call a live model')

    const aapl = await fetch(webUrl(DEMO_WORKSPACE_ID, DEMO_SESSION_ID)).then((response) => response.json())
    expect(JSON.stringify(aapl.snapshot.messages)).not.toContain('What would confirm the move?')
  })

  it('rejects an empty prompt like the real route', async () => {
    const { status, body } = await postJson(webUrl(DEMO_CHAT_WORKSPACE_ID, DEMO_CHAT_SESSION_ID, '/prompt'), { message: '  ' })
    expect(status).toBe(400)
    expect(body.error).toBe('bad_request')
  })

  it('creates a durable in-memory Web Session when demo Quick Chat launches Pi', async () => {
    const body = await quickChat('pi', 'Map the next confirmation signals.')

    expect(body.session).toMatchObject({ agent: 'pi', surface: 'webpi' })
    expect(body.workspace.sessions.some((session: { id: string }) => session.id === body.session.sessionId)).toBe(true)

    const snapshotResponse = await fetch(webUrl(DEMO_CHAT_WORKSPACE_ID, body.session.sessionId))
    const snapshot = await snapshotResponse.json()
    expect(snapshotResponse.status).toBe(200)
    expect(snapshot.snapshot).toMatchObject({ recordId: body.session.sessionId, agent: 'pi', phase: 'idle' })
    expect(JSON.stringify(snapshot.snapshot.messages)).toContain('Map the next confirmation signals.')

    const workspaceList = await fetch(`${baseUrl}/api/workspaces`).then((result) => result.json())
    const chatWorkspace = workspaceList.workspaces.find(
      (workspace: { id: string }) => workspace.id === DEMO_CHAT_WORKSPACE_ID,
    )
    expect(chatWorkspace.sessions.some((session: { id: string }) => session.id === body.session.sessionId)).toBe(true)
  })

  it('opens every runtime with a structured protocol in the Web surface and keeps TUI-only runtimes in the terminal', async () => {
    const claude = await quickChat('claude', 'Check the desk notes.')
    expect(claude.session).toMatchObject({ agent: 'claude', surface: 'webpi' })

    const agy = await quickChat('agy', 'Check the desk notes.')
    expect(agy.session).toMatchObject({ agent: 'agy', surface: 'terminal' })

    const open = await postJson(webUrl(DEMO_CHAT_WORKSPACE_ID, agy.session.sessionId, '/open'))
    expect(open.status).toBe(409)
    expect(open.body.error).toBe('unsupported_surface')
  })

  it('pauses a prompting runtime on a permission request and finishes the turn from the answer', async () => {
    const launched = await quickChat('claude', 'Check the desk notes.')
    const sessionId = launched.session.sessionId

    const pending = await fetch(webUrl(DEMO_CHAT_WORKSPACE_ID, sessionId)).then((response) => response.json())
    expect(pending.snapshot).toMatchObject({ agent: 'claude', wire: 'claude-stream-json', phase: 'awaiting-input' })
    expect(pending.snapshot.requests).toHaveLength(1)
    expect(pending.snapshot.requests[0]).toMatchObject({ kind: 'permission', tool: { name: 'read' } })
    expect(pending.snapshot.streamingMessage.role).toBe('assistant')

    const blocked = await postJson(webUrl(DEMO_CHAT_WORKSPACE_ID, sessionId, '/prompt'), { message: 'hurry' })
    expect(blocked.status).toBe(409)

    const wrongOption = await postJson(webUrl(DEMO_CHAT_WORKSPACE_ID, sessionId, '/respond'), {
      requestId: pending.snapshot.requests[0].id,
      optionId: 'nope',
    })
    expect(wrongOption.status).toBe(409)
    expect(wrongOption.body.error).toBe('web_respond_failed')

    const answered = await postJson(webUrl(DEMO_CHAT_WORKSPACE_ID, sessionId, '/respond'), {
      requestId: pending.snapshot.requests[0].id,
      optionId: 'allow',
    })
    expect(answered.status).toBe(200)
    expect(answered.body.snapshot).toMatchObject({ phase: 'idle', requests: [], streamingMessage: null })
    const roles = answered.body.snapshot.messages.map((message: { role: string }) => message.role)
    expect(roles).toEqual(['user', 'assistant', 'toolResult', 'assistant'])
    expect(answered.body.snapshot.messages[2]).toMatchObject({ isError: false })
  })

  it('offers ACP-style option ids for ACP runtimes and records a denial as a failed tool result', async () => {
    const launched = await quickChat('cursor', 'Check the desk notes.')
    const sessionId = launched.session.sessionId
    const pending = await fetch(webUrl(DEMO_CHAT_WORKSPACE_ID, sessionId)).then((response) => response.json())
    expect(pending.snapshot.wire).toBe('acp')
    expect(pending.snapshot.requests[0].options.map((option: { id: string }) => option.id))
      .toEqual(['allow_once', 'allow_always', 'reject_once'])

    const denied = await postJson(webUrl(DEMO_CHAT_WORKSPACE_ID, sessionId, '/respond'), {
      requestId: pending.snapshot.requests[0].id,
      optionId: 'reject_once',
    })
    expect(denied.status).toBe(200)
    expect(denied.body.snapshot.messages[2]).toMatchObject({ role: 'toolResult', isError: true })
  })

  it('drops a pending request when the turn is aborted and leaves a notice in the transcript', async () => {
    const launched = await quickChat('codex', 'Check the desk notes.')
    const sessionId = launched.session.sessionId

    const aborted = await postJson(webUrl(DEMO_CHAT_WORKSPACE_ID, sessionId, '/abort'))
    expect(aborted.status).toBe(200)
    expect(aborted.body.snapshot).toMatchObject({ phase: 'idle', requests: [], streamingMessage: null })
    expect(aborted.body.snapshot.messages.at(-1)).toEqual({ role: 'notice', text: 'Turn stopped by the user.' })
  })
})


it('round-trips a Codex free-text question in demo mode', async () => {
  const body = await quickChat('codex', 'Ask me for a project name')
  const url = webUrl(DEMO_CHAT_WORKSPACE_ID, body.session.sessionId)
  const current = await fetch(url).then((response) => response.json())
  const request = current.snapshot.requests[0]
  expect(request).toMatchObject({ kind: 'question', options: [], allowText: true })
  const result = await postJson(`${url}/respond`, { requestId: request.id, optionId: '', text: 'Alice research' })
  expect(result.status).toBe(200)
  expect(result.body.snapshot.requests).toEqual([])
  expect(JSON.stringify(result.body.snapshot.messages)).toContain('Project name: Alice research')
})
