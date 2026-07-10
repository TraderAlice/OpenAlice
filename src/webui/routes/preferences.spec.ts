import { describe, expect, it, vi } from 'vitest'

import { createPreferencesRoutes } from './preferences.js'

describe('preferences routes', () => {
  it('reads the non-sensitive quick-chat preference map', async () => {
    const read = vi.fn(async () => ({ lastCredentialByAgent: { pi: 'minimax-1' } }))
    const app = createPreferencesRoutes({
      readQuickChatPreferences: read,
      rememberQuickChatCredential: vi.fn(),
    })

    const response = await app.request('/quick-chat')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ lastCredentialByAgent: { pi: 'minimax-1' } })
    expect(read).toHaveBeenCalledOnce()
  })

  it('persists a provider choice for a loginless runtime', async () => {
    const remember = vi.fn(async (agent: string, credentialSlug: string | null) => ({
      lastCredentialByAgent: { [agent]: credentialSlug! },
    }))
    const app = createPreferencesRoutes({
      readQuickChatPreferences: vi.fn(),
      rememberQuickChatCredential: remember,
    })

    const response = await app.request('/quick-chat', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'pi', credentialSlug: 'minimax-1' }),
    })
    expect(response.status).toBe(200)
    expect(remember).toHaveBeenCalledWith('pi', 'minimax-1')
  })

  it('rejects unknown runtimes and empty slugs without writing', async () => {
    const remember = vi.fn()
    const app = createPreferencesRoutes({
      readQuickChatPreferences: vi.fn(),
      rememberQuickChatCredential: remember,
    })

    for (const body of [
      { agent: 'codex', credentialSlug: 'openai-1' },
      { agent: 'pi', credentialSlug: '' },
    ]) {
      const response = await app.request('/quick-chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
    }
    expect(remember).not.toHaveBeenCalled()
  })
})
