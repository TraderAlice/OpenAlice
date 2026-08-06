import { http, HttpResponse } from 'msw'

const lastCredentialByAgent: Record<string, string> = { pi: 'minimax-1' }
let recentChatWorkspaceId: string | null = 'demo-chat-ws'
let recentLaunch = {
  agent: 'pi',
  credentialSlug: 'minimax-1' as string | null,
  model: null as string | null,
  reasoningEffort: null as string | null,
}

export const preferencesHandlers = [
  http.get('/api/preferences/quick-chat', () =>
    HttpResponse.json({
      lastCredentialByAgent: { ...lastCredentialByAgent },
      recentChatWorkspaceId,
      recentLaunch,
    }),
  ),
  http.put('/api/preferences/quick-chat', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      agent?: unknown
      credentialSlug?: unknown
    } | null
    if (
      !body ||
      (body.agent !== 'opencode' && body.agent !== 'pi') ||
      (typeof body.credentialSlug !== 'string' && body.credentialSlug !== null)
    ) {
      return HttpResponse.json({ error: 'invalid_quick_chat_preference' }, { status: 400 })
    }
    if (body.credentialSlug === null) delete lastCredentialByAgent[body.agent]
    else lastCredentialByAgent[body.agent] = body.credentialSlug
    return HttpResponse.json({
      lastCredentialByAgent: { ...lastCredentialByAgent },
      recentChatWorkspaceId,
      recentLaunch,
    })
  }),
  http.put('/api/preferences/quick-chat/recent-workspace', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { workspaceId?: unknown } | null
    if (!body || (typeof body.workspaceId !== 'string' && body.workspaceId !== null)) {
      return HttpResponse.json({ error: 'invalid_quick_chat_workspace_preference' }, { status: 400 })
    }
    recentChatWorkspaceId = body.workspaceId
    return HttpResponse.json({
      lastCredentialByAgent: { ...lastCredentialByAgent },
      recentChatWorkspaceId,
      recentLaunch,
    })
  }),
  http.put('/api/preferences/quick-chat/recent-launch', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as typeof recentLaunch | null
    if (!body || typeof body.agent !== 'string') {
      return HttpResponse.json({ error: 'invalid_quick_chat_launch_preference' }, { status: 400 })
    }
    recentLaunch = body
    if (body.credentialSlug === null) delete lastCredentialByAgent[body.agent]
    else lastCredentialByAgent[body.agent] = body.credentialSlug
    return HttpResponse.json({
      lastCredentialByAgent: { ...lastCredentialByAgent },
      recentChatWorkspaceId,
      recentLaunch,
    })
  }),
  // Vercel demo is not a Windows host, so the machine-local shell setting is
  // intentionally absent from General Settings.
  http.get('/api/preferences/workspace-shell', () =>
    HttpResponse.json({ supported: false }),
  ),
]
