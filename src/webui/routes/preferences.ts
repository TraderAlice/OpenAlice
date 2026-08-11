import { Hono } from 'hono'
import { z } from 'zod'

import {
  readQuickChatPreferences,
  rememberQuickChatCredential,
  rememberQuickChatLaunch,
  rememberRecentChatWorkspace,
  type QuickChatPreferences,
} from '../../core/preferences.js'
import {
  getWindowsWorkspaceShellStatus,
  InvalidWindowsWorkspaceShellPathError,
  saveWindowsWorkspaceShellPreference,
  type WindowsWorkspaceShellStatus,
} from '../../core/windows-workspace-shell.js'
import type { AdapterRegistry } from '../../workspaces/cli-adapter.js'
import { createBuiltinAdapterRegistry } from '../../workspaces/adapters/index.js'

const quickChatPreferenceUpdateSchema = z.object({
  agent: z.string().trim().min(1).max(128),
  credentialSlug: z.string().trim().min(1).max(128).nullable(),
})

const recentChatWorkspaceUpdateSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128).nullable(),
})

const modelReasoningEffortSchema = z.enum([
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
])

const recentQuickChatLaunchUpdateSchema = z.object({
  agent: z.string().trim().min(1).max(128),
  accessMode: z.enum(['auto', 'native', 'vault']).optional(),
  credentialSlug: z.string().trim().min(1).max(128).nullable(),
  model: z.string().trim().min(1).max(256).nullable(),
  reasoningEffort: modelReasoningEffortSchema.nullable(),
}).transform((value) => ({
  ...value,
  accessMode: value.accessMode ?? (value.credentialSlug === null ? 'auto' as const : 'vault' as const),
})).refine(
  (value) => value.accessMode === 'vault' ? value.credentialSlug !== null : value.credentialSlug === null,
  { message: 'access mode and credential must agree' },
)

const workspaceShellPreferenceUpdateSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto'), customPath: z.null().optional() }),
  z.object({ mode: z.literal('custom'), customPath: z.string().trim().min(1).max(1024) }),
])

interface PreferenceRouteDeps {
  readQuickChatPreferences(): Promise<QuickChatPreferences>
  rememberQuickChatCredential(agent: string, credentialSlug: string | null): Promise<QuickChatPreferences>
  rememberQuickChatLaunch?(launch: NonNullable<QuickChatPreferences['recentLaunch']>): Promise<QuickChatPreferences>
  rememberRecentChatWorkspace(workspaceId: string | null): Promise<QuickChatPreferences>
  getWorkspaceShellStatus(): Promise<WindowsWorkspaceShellStatus>
  saveWorkspaceShellPreference(input: {
    mode: 'auto' | 'custom'
    customPath?: string | null
  }): Promise<WindowsWorkspaceShellStatus>
}

const defaultDeps: PreferenceRouteDeps = {
  readQuickChatPreferences: () => readQuickChatPreferences(),
  rememberQuickChatCredential: (agent, credentialSlug) =>
    rememberQuickChatCredential(agent, credentialSlug),
  rememberQuickChatLaunch: (launch) => rememberQuickChatLaunch(launch),
  rememberRecentChatWorkspace: (workspaceId) => rememberRecentChatWorkspace(workspaceId),
  getWorkspaceShellStatus: () => getWindowsWorkspaceShellStatus(),
  saveWorkspaceShellPreference: (input) => saveWindowsWorkspaceShellPreference(input),
}

export function createPreferencesRoutes(
  deps: PreferenceRouteDeps = defaultDeps,
  adapterRegistry: AdapterRegistry = createBuiltinAdapterRegistry(),
) {
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
    const adapter = adapterRegistry.get(parsed.data.agent)
    if (!adapter?.capabilities.aiProvider) {
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

  app.put('/quick-chat/recent-workspace', async (c) => {
    const parsed = recentChatWorkspaceUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_quick_chat_workspace_preference' }, 400)
    }
    try {
      return c.json(await deps.rememberRecentChatWorkspace(parsed.data.workspaceId))
    } catch (error) {
      return c.json({ error: 'preferences_write_failed', message: String(error) }, 500)
    }
  })

  app.put('/quick-chat/recent-launch', async (c) => {
    const parsed = recentQuickChatLaunchUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || !adapterRegistry.get(parsed.data?.agent ?? '')?.capabilities.aiProvider) {
      return c.json({ error: 'invalid_quick_chat_launch_preference' }, 400)
    }
    try {
      return c.json(await (deps.rememberQuickChatLaunch ?? defaultDeps.rememberQuickChatLaunch!)(parsed.data))
    } catch (error) {
      return c.json({ error: 'preferences_write_failed', message: String(error) }, 500)
    }
  })

  app.get('/workspace-shell', async (c) => {
    try {
      return c.json(await deps.getWorkspaceShellStatus())
    } catch (error) {
      return c.json({ error: 'workspace_shell_read_failed', message: String(error) }, 500)
    }
  })

  app.put('/workspace-shell', async (c) => {
    const parsed = workspaceShellPreferenceUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_workspace_shell_preference' }, 400)
    try {
      const status = await deps.saveWorkspaceShellPreference(parsed.data)
      if (!status.supported) return c.json({ error: 'unsupported_platform' }, 400)
      return c.json(status)
    } catch (error) {
      if (error instanceof InvalidWindowsWorkspaceShellPathError) {
        return c.json({ error: 'invalid_workspace_shell_path', message: error.message }, 400)
      }
      return c.json({ error: 'workspace_shell_write_failed', message: String(error) }, 500)
    }
  })

  return app
}
