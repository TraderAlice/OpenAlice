import { afterEach, describe, expect, it, vi } from 'vitest'

import { resumeSession } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resumeSession', () => {
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
