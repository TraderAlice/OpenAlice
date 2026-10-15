// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { en } from '../../i18n/locales/en'

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
  vi.restoreAllMocks()
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
  it('shows a suggested workflow in the standard GUI snapshot without a fake tool approval', async () => {
    const body = await quickChat('codex', en.chatLanding.researchMemoPrompt)
    const url = webUrl(body.workspace.id, body.session.sessionId)
    const first = await fetch(url).then(response => response.json())
    expect(first.snapshot.phase).toBe('working')
    expect(first.snapshot.messages).toHaveLength(1)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 2500)
    const partial = await fetch(url).then(response => response.json())
    expect(partial.snapshot.streamingMessage.content[0].text.length).toBeGreaterThan(0)
    expect(partial.snapshot.phase).toBe('working')
    vi.spyOn(Date, 'now').mockReturnValue(now + 60000)
    const { snapshot } = await fetch(url).then(response => response.json())
    expect(snapshot.revision).toBeGreaterThan(partial.snapshot.revision)
    expect(snapshot.streamingMessage).toBeNull()
    expect(body.session.surface).toBe('webpi')
    expect(body.session.title).toBe(en.chatLanding.researchMemoTitle)
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.requests).toEqual([])
    expect(snapshot.messages[0]).toMatchObject({ role: 'user', content: en.chatLanding.researchMemoPrompt })
    expect(JSON.stringify(snapshot.messages[1])).toContain('a thesis with an exit condition')
    expect(JSON.stringify(snapshot.messages[1])).toContain('[Install OpenAlice]')
  })

  it('stops a demo stream without later restoring the pending answer', async () => {
    const body = await quickChat('pi', en.chatLanding.marketBriefPrompt)
    const url = webUrl(body.workspace.id, body.session.sessionId)
    await postJson(url + '/abort')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60000)
    const { snapshot } = await fetch(url).then(response => response.json())
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.streamingMessage).toBeNull()
    expect(snapshot.messages.some((message: { role: string }) => message.role === 'assistant')).toBe(false)
  })

  it('serves a real inline sticker through Workspace content', async () => {
    const url = `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/content?path=sticker/wave.png`
    expect(await fetch(url + '&metadata=1').then(response => response.json())).toMatchObject({ path: 'sticker/wave.png' })
    const response = await fetch(url)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })

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

it('exposes a representative execution history for a known demo Session and rejects unknown identities', async () => {
  const path = `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/sessions`
  expect(await (await fetch(`${path}/${DEMO_CHAT_SESSION_ID}/executions`)).json()).toMatchObject({ executions: [{ executionId: `demo-execution-${DEMO_CHAT_SESSION_ID}`, origin: { kind: 'user', entry: 'quick-start' } }] })
  expect((await fetch(`${path}/missing/executions`)).status).toBe(404)
})

it('demo interruption enters cooldown; releasing it does not restart the Session', async () => {
  const base = `${baseUrl}/api/workspaces/${DEMO_CHAT_WORKSPACE_ID}/sessions/demo-chat-headless-claude`
  const before = await fetch(`${base}/control`).then(response => response.json())
  expect(before.execution.phase).toBe('running')
  const stop = await postJson(`${base}/interrupt`, { executionId: before.execution.executionId })
  expect(stop.status).toBe(200)
  const blocked = await fetch(`${base}/control`).then(response => response.json())
  expect(blocked.execution).toBeNull()
  const history = await fetch(`${base}/executions`).then(response => response.json())
  expect(history.executions[0]).toMatchObject({ phase: 'interrupted', reason: 'user-interrupted' })
  expect(blocked.blocks[0].kind).toBe('user-cooldown')
  await postJson(`${base}/blocks/${blocked.blocks[0].id}/release`)
  expect(await fetch(`${base}/control`).then(response => response.json())).toMatchObject({ execution: null, blocks: [] })
})
