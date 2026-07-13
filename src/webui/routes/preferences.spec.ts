import { describe, expect, it, vi } from 'vitest'

import { createPreferencesRoutes } from './preferences.js'

const unusedShellStatus = vi.fn(async () => ({ supported: false as const }))
const unusedShellSave = vi.fn(async () => ({ supported: false as const }))
const unusedRecentWorkspace = vi.fn(async () => ({
  lastCredentialByAgent: {},
  recentChatWorkspaceId: null,
}))

describe('preferences routes', () => {
  it('reads the non-sensitive quick-chat preference map', async () => {
    const read = vi.fn(async () => ({
      lastCredentialByAgent: { pi: 'minimax-1' },
      recentChatWorkspaceId: 'chat-calm-river',
    }))
    const app = createPreferencesRoutes({
      readQuickChatPreferences: read,
      rememberQuickChatCredential: vi.fn(),
      rememberRecentChatWorkspace: unusedRecentWorkspace,
      getWorkspaceShellStatus: unusedShellStatus,
      saveWorkspaceShellPreference: unusedShellSave,
    })

    const response = await app.request('/quick-chat')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      lastCredentialByAgent: { pi: 'minimax-1' },
      recentChatWorkspaceId: 'chat-calm-river',
    })
    expect(read).toHaveBeenCalledOnce()
  })

  it('persists a provider choice for a loginless runtime', async () => {
    const remember = vi.fn(async (agent: string, credentialSlug: string | null) => ({
      lastCredentialByAgent: { [agent]: credentialSlug! },
      recentChatWorkspaceId: null,
    }))
    const app = createPreferencesRoutes({
      readQuickChatPreferences: vi.fn(),
      rememberQuickChatCredential: remember,
      rememberRecentChatWorkspace: unusedRecentWorkspace,
      getWorkspaceShellStatus: unusedShellStatus,
      saveWorkspaceShellPreference: unusedShellSave,
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
      rememberRecentChatWorkspace: unusedRecentWorkspace,
      getWorkspaceShellStatus: unusedShellStatus,
      saveWorkspaceShellPreference: unusedShellSave,
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

  it('persists and clears the recent chat workspace id', async () => {
    const remember = vi.fn(async (workspaceId: string | null) => ({
      lastCredentialByAgent: {},
      recentChatWorkspaceId: workspaceId,
    }))
    const app = createPreferencesRoutes({
      readQuickChatPreferences: vi.fn(),
      rememberQuickChatCredential: vi.fn(),
      rememberRecentChatWorkspace: remember,
      getWorkspaceShellStatus: unusedShellStatus,
      saveWorkspaceShellPreference: unusedShellSave,
    })

    for (const workspaceId of ['chat-calm-river', null]) {
      const response = await app.request('/quick-chat/recent-workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      expect(response.status).toBe(200)
    }
    expect(remember).toHaveBeenNthCalledWith(1, 'chat-calm-river')
    expect(remember).toHaveBeenNthCalledWith(2, null)
  })

  it('reads and updates the Windows workspace shell preference', async () => {
    const status = {
      supported: true as const,
      mode: 'auto' as const,
      customPath: null,
      resolvedPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
      source: 'git-for-windows' as const,
      valid: true,
      message: null,
    }
    const read = vi.fn(async () => status)
    const save = vi.fn(async () => ({
      ...status,
      mode: 'custom' as const,
      customPath: 'D:\\Git\\bin\\bash.exe',
      resolvedPath: 'D:\\Git\\bin\\bash.exe',
      source: 'custom' as const,
    }))
    const app = createPreferencesRoutes({
      readQuickChatPreferences: vi.fn(),
      rememberQuickChatCredential: vi.fn(),
      rememberRecentChatWorkspace: unusedRecentWorkspace,
      getWorkspaceShellStatus: read,
      saveWorkspaceShellPreference: save,
    })

    expect(await (await app.request('/workspace-shell')).json()).toEqual(status)
    const response = await app.request('/workspace-shell', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'custom', customPath: 'D:\\Git\\bin\\bash.exe' }),
    })
    expect(response.status).toBe(200)
    expect(save).toHaveBeenCalledWith({ mode: 'custom', customPath: 'D:\\Git\\bin\\bash.exe' })
  })

  it('rejects malformed workspace shell preferences', async () => {
    const save = vi.fn()
    const app = createPreferencesRoutes({
      readQuickChatPreferences: vi.fn(),
      rememberQuickChatCredential: vi.fn(),
      rememberRecentChatWorkspace: unusedRecentWorkspace,
      getWorkspaceShellStatus: unusedShellStatus,
      saveWorkspaceShellPreference: save,
    })
    const response = await app.request('/workspace-shell', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'custom', customPath: '' }),
    })
    expect(response.status).toBe(400)
    expect(save).not.toHaveBeenCalled()
  })
})
