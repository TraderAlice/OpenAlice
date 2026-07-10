import { Hono } from 'hono'
import { z } from 'zod'

import {
  readQuickChatPreferences,
  rememberQuickChatCredential,
  type QuickChatPreferences,
} from '../../core/preferences.js'

const LOGINLESS_AGENTS = ['opencode', 'pi'] as const

const quickChatPreferenceUpdateSchema = z.object({
  agent: z.enum(LOGINLESS_AGENTS),
  credentialSlug: z.string().trim().min(1).max(128).nullable(),
})

interface PreferenceRouteDeps {
  readQuickChatPreferences(): Promise<QuickChatPreferences>
  rememberQuickChatCredential(agent: string, credentialSlug: string | null): Promise<QuickChatPreferences>
}

const defaultDeps: PreferenceRouteDeps = {
  readQuickChatPreferences: () => readQuickChatPreferences(),
  rememberQuickChatCredential: (agent, credentialSlug) =>
    rememberQuickChatCredential(agent, credentialSlug),
}

export function createPreferencesRoutes(deps: PreferenceRouteDeps = defaultDeps) {
  const app = new Hono()

  app.get('/quick-chat', async (c) => {
    try {
      return c.json(await deps.readQuickChatPreferences())
    } catch (error) {
      return c.json({ error: 'preferences_read_failed', message: String(error) }, 500)
    }
  })

  app.put('/quick-chat', async (c) => {
    const parsed = quickChatPreferenceUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_quick_chat_preference' }, 400)
    }
    try {
      return c.json(await deps.rememberQuickChatCredential(
        parsed.data.agent,
        parsed.data.credentialSlug,
      ))
    } catch (error) {
      return c.json({ error: 'preferences_write_failed', message: String(error) }, 500)
    }
  })

  return app
}
