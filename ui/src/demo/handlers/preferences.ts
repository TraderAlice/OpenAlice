import { http, HttpResponse } from 'msw'

const lastCredentialByAgent: Record<string, string> = { pi: 'minimax-1' }
let recentChatWorkspaceId: string | null = 'demo-chat-ws'
let recentLaunch = {
  agent: 'pi',
  credentialSlug: 'minimax-1' as string | null,
  model: null as string | null,
  reasoningEffort: null as string | null,
}
let showHeadlessBornSessions = false
let showUnverifiedHarnessReleases = false
let agentRuntimeQuickAccessIds: string[] = []
let recentAgentRuntimeIds: string[] = []

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
  http.get('/api/preferences/harness', () =>
    HttpResponse.json({ showHeadlessBornSessions, showUnverifiedHarnessReleases }),
  ),
  http.put('/api/preferences/harness', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      showHeadlessBornSessions?: unknown
      showUnverifiedHarnessReleases?: unknown
    } | null
    if (
      !body
      || typeof body.showHeadlessBornSessions !== 'boolean'
      || typeof body.showUnverifiedHarnessReleases !== 'boolean'
    ) {
      return HttpResponse.json({ error: 'invalid_harness_preference' }, { status: 400 })
    }
    showHeadlessBornSessions = body.showHeadlessBornSessions
    showUnverifiedHarnessReleases = body.showUnverifiedHarnessReleases
    return HttpResponse.json({ showHeadlessBornSessions, showUnverifiedHarnessReleases })
  }),
  http.get('/api/preferences/agent-runtimes', () =>
    HttpResponse.json({
      quickAccessIds: [...agentRuntimeQuickAccessIds],
      recentAgentIds: [...recentAgentRuntimeIds],
    }),
  ),
  http.put('/api/preferences/agent-runtimes', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      quickAccessIds?: unknown
    } | null
    if (!body || !Array.isArray(body.quickAccessIds) || body.quickAccessIds.length > 4) {
      return HttpResponse.json({ error: 'invalid_agent_runtime_preference' }, { status: 400 })
    }
    const ids: string[] = []
    for (const id of body.quickAccessIds) {
      if (typeof id !== 'string' || id.trim().length === 0 || ids.includes(id)) {
        return HttpResponse.json({ error: 'invalid_agent_runtime_preference' }, { status: 400 })
      }
      ids.push(id)
    }
    agentRuntimeQuickAccessIds = ids
    return HttpResponse.json({
      quickAccessIds: [...agentRuntimeQuickAccessIds],
      recentAgentIds: [...recentAgentRuntimeIds],
    })
  }),
  http.put('/api/preferences/agent-runtimes/recent', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { agentId?: unknown } | null
    if (!body || typeof body.agentId !== 'string' || body.agentId.trim().length === 0) {
      return HttpResponse.json({ error: 'invalid_agent_runtime_preference' }, { status: 400 })
    }
    recentAgentRuntimeIds = [
      body.agentId,
      ...recentAgentRuntimeIds.filter((id) => id !== body.agentId),
    ].slice(0, 4)
    return HttpResponse.json({
      quickAccessIds: [...agentRuntimeQuickAccessIds],
      recentAgentIds: [...recentAgentRuntimeIds],
    })
  }),
]
