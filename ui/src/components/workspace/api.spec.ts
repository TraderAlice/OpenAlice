import { afterEach, describe, expect, it, vi } from 'vitest'

import { resumeSession } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resumeSession', () => {
  it.each([null, {}, { sessionId: 'pi-paused', wsId: 'chat-1', pid: null, startedAt: 1 }])('rejects malformed successful responses: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))
    await expect(resumeSession('chat-1', 'pi-paused')).rejects.toThrow('invalid response')
  })

  it('accepts the Demo pid sentinel', async () => {
    const body = { sessionId: 'pi-paused', wsId: 'chat-1', pid: 0, startedAt: 1 }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))
    await expect(resumeSession('chat-1', 'pi-paused')).resolves.toEqual(body)
  })
  it('rejects with the server diagnostic instead of resolving an empty Session', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: 'agent_credential_failed',
      message: 'Pi CLI login is required',
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(resumeSession('chat-1', 'pi-paused'))
      .rejects.toThrow('Pi CLI login is required')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/chat-1/sessions/pi-paused/resume',
      { method: 'POST' },
    )
  })
})
