import { fetchJson, headers } from './client'

export interface QuickChatPreferences {
  lastCredentialByAgent: Record<string, string>
}

export const preferencesApi = {
  getQuickChat(): Promise<QuickChatPreferences> {
    return fetchJson('/api/preferences/quick-chat')
  },

  rememberQuickChatCredential(
    agent: 'opencode' | 'pi',
    credentialSlug: string | null,
  ): Promise<QuickChatPreferences> {
    return fetchJson('/api/preferences/quick-chat', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ agent, credentialSlug }),
    })
  },
}
