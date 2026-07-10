import { http, HttpResponse } from 'msw'
import { demoChatWorkspace, demoWorkspaces, demoTemplates } from '../fixtures/workspaces'
import { demoWorkspaceFiles } from '../fixtures/inbox'
import type { WorkspaceMetadataPatch } from '../../components/workspace/api'

const demoAgentRuntimeReadiness = {
  agents: {
    claude: {
      agent: 'claude',
      displayName: 'Claude Code',
      installed: true,
      binPath: '/usr/local/bin/claude',
      status: 'ready',
      ready: true,
      source: 'global-login',
      checkedAt: '2026-07-08T00:00:00.000Z',
      durationMs: 12,
      message: 'Claude Code replied to the readiness probe.',
    },
    codex: {
      agent: 'codex',
      displayName: 'Codex',
      installed: true,
      binPath: '/usr/local/bin/codex',
      status: 'ready',
      ready: true,
      source: 'global-login',
      checkedAt: '2026-07-08T00:00:00.000Z',
      durationMs: 14,
      message: 'Codex replied to the readiness probe.',
    },
    opencode: {
      agent: 'opencode',
      displayName: 'opencode',
      installed: true,
      binPath: '/usr/local/bin/opencode',
      status: 'ready',
      ready: true,
      source: 'launcher-vault',
      checkedAt: '2026-07-08T00:00:00.000Z',
      durationMs: 18,
      message: 'opencode replied to the readiness probe.',
    },
    pi: {
      agent: 'pi',
      displayName: 'Pi',
      installed: true,
      binPath: '/usr/local/bin/pi',
      status: 'ready',
      ready: true,
      source: 'launcher-vault',
      checkedAt: '2026-07-08T00:00:00.000Z',
      durationMs: 16,
      message: 'Pi replied to the readiness probe.',
    },
  },
  overallReady: true,
  checkedAt: '2026-07-08T00:00:00.000Z',
}

export const workspacesHandlers = [
  http.get('/api/workspaces', () => HttpResponse.json({ workspaces: demoWorkspaces })),
  http.post('/api/workspaces', () =>
    HttpResponse.json(
      { ok: false, status: 400, error: { error: 'bootstrap_failed', message: 'Demo mode — workspace creation is disabled.' } },
      { status: 400 },
    ),
  ),
  http.delete('/api/workspaces/:id', () => HttpResponse.json(true)),
  http.post('/api/workspaces/:id/stop', () => HttpResponse.json(true)),
  http.patch('/api/workspaces/:id/metadata', async ({ params, request }) => {
    const workspace = demoWorkspaces.find((w) => w.id === String(params.id))
    if (!workspace) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const mutableWorkspace = workspace as { displayName?: string; description?: string }

    const body = (await request.json().catch(() => ({}))) as WorkspaceMetadataPatch
    if ('displayName' in body) {
      if (body.displayName == null || body.displayName.trim() === '') {
        delete mutableWorkspace.displayName
      } else {
        mutableWorkspace.displayName = body.displayName.trim()
      }
    }
    if ('description' in body) {
      if (body.description == null || body.description.trim() === '') {
        delete mutableWorkspace.description
      } else {
        mutableWorkspace.description = body.description.trim()
      }
    }
    return HttpResponse.json({ workspace })
  }),

  http.get('/api/workspaces/templates', () => HttpResponse.json({ templates: demoTemplates })),
  http.get('/api/workspaces/templates/:name/readme', () =>
    HttpResponse.text('', { status: 404 }),
  ),

  http.get('/api/workspaces/agents', () =>
    HttpResponse.json({
      // `installed` is PATH-probed on a real backend; the demo has no host to
      // probe, so present everything as installed (a clean showcase, not a
      // "go install things" prompt).
      agents: [
        { id: 'claude', displayName: 'Claude Code', installed: true, binPath: '/usr/local/bin/claude', capabilities: { parallelPerCwd: true, resumeLast: false, resumeById: true, transcriptDiscovery: 'fs-watch' } },
        { id: 'codex', displayName: 'Codex', installed: true, binPath: '/usr/local/bin/codex', capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'subprocess' } },
        { id: 'opencode', displayName: 'opencode', installed: true, binPath: '/usr/local/bin/opencode', capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'subprocess' } },
        { id: 'pi', displayName: 'Pi', installed: true, binPath: '/usr/local/bin/pi', capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'none' } },
      ],
    }),
  ),
  http.get('/api/workspaces/agent-runtime-readiness', () =>
    HttpResponse.json(demoAgentRuntimeReadiness),
  ),
  http.post('/api/workspaces/agent-runtime-readiness/probe', () =>
    HttpResponse.json(demoAgentRuntimeReadiness),
  ),
  // Two sample vault credentials let the quick-chat demo show that a remembered
  // provider can win over the first compatible option. Both speak openai-chat,
  // which every loginless runtime accepts.
  http.get('/api/workspaces/credentials', () =>
    HttpResponse.json({
      credentials: [
        { slug: 'openai-1', vendor: 'openai', label: 'OpenAI', authType: 'api-key', wires: { 'openai-chat': '' }, lastModel: 'gpt-5.5', apiKey: null },
        { slug: 'minimax-1', vendor: 'minimax', label: 'MiniMax', authType: 'api-key', wires: { 'openai-chat': '' }, lastModel: 'MiniMax-M2.1', apiKey: null },
      ],
    }),
  ),
  http.post('/api/workspaces/credentials', () =>
    HttpResponse.json({ slug: 'custom-1', vendor: 'custom' }, { status: 201 }),
  ),

  http.get('/api/workspaces/:id/git/log', () => HttpResponse.json({ entries: [] })),
  http.get('/api/workspaces/:id/git/status', () =>
    HttpResponse.json({ branch: 'main', clean: true, files: [] }),
  ),
  http.get('/api/workspaces/:id/files', () =>
    HttpResponse.json({ path: '/', entries: [] }),
  ),
  http.get('/api/workspaces/:id/file', ({ request }) => {
    const url = new URL(request.url)
    const path = url.searchParams.get('path') ?? ''
    const content = demoWorkspaceFiles[path]
    if (content != null) return HttpResponse.json({ content })
    return HttpResponse.json({ error: 'file_not_found' }, { status: 404 })
  }),

  http.post('/api/workspaces/:id/sessions/spawn', ({ params }) =>
    HttpResponse.json({
      sessionId: 'demo-session',
      wsId: String(params.id),
      name: 'c1',
      pid: 0,
      startedAt: Date.now(),
      agent: 'claude',
      agentSessionId: null,
      title: null,
    }),
  ),

  // Quick-chat launch — reuse the first demo chat workspace and hand back the
  // scripted demo session (the Terminal short-circuits to DemoTerminalReplay).
  http.post('/api/workspaces/quick-chat', () => {
    const ws = demoChatWorkspace
    return HttpResponse.json(
      {
        workspace: ws,
        session: {
          sessionId: 'demo-session',
          wsId: ws.id,
          name: 'c1',
          pid: 0,
          startedAt: Date.now(),
          agent: 'claude',
          agentSessionId: null,
          title: null,
        },
      },
      { status: 201 },
    )
  }),
  http.post('/api/workspaces/:id/sessions/:sid/pause', () => HttpResponse.json(true)),
  http.post('/api/workspaces/:id/sessions/:sid/resume', () => HttpResponse.json(null)),
  http.delete('/api/workspaces/:id/sessions/:sid', () => HttpResponse.json(true)),
  http.get('/api/workspaces/:id/sessions/:sid/diagnostics', () =>
    HttpResponse.json({ status: 'demo' }),
  ),

  http.get('/api/workspaces/:id/agent-config', () => HttpResponse.json({})),
  http.get('/api/workspaces/:id/agent-readiness', () =>
    HttpResponse.json({
      agents: {
        claude: {
          agent: 'claude',
          ready: true,
          requiresCredential: false,
          source: 'runtime-login',
          hasWorkspaceConfig: false,
          hasUsableWorkspaceConfig: false,
          detectedCredentialSlug: null,
          compatibleCredentialSlugs: [],
          injectableCredentialSlugs: [],
        },
        codex: {
          agent: 'codex',
          ready: true,
          requiresCredential: false,
          source: 'runtime-login',
          hasWorkspaceConfig: false,
          hasUsableWorkspaceConfig: false,
          detectedCredentialSlug: null,
          compatibleCredentialSlugs: [],
          injectableCredentialSlugs: [],
        },
        opencode: {
          agent: 'opencode',
          ready: true,
          requiresCredential: true,
          source: 'launcher-vault',
          hasWorkspaceConfig: false,
          hasUsableWorkspaceConfig: false,
          detectedCredentialSlug: null,
          compatibleCredentialSlugs: ['openai-1', 'minimax-1'],
          injectableCredentialSlugs: ['openai-1', 'minimax-1'],
        },
        pi: {
          agent: 'pi',
          ready: true,
          requiresCredential: true,
          source: 'launcher-vault',
          hasWorkspaceConfig: false,
          hasUsableWorkspaceConfig: false,
          detectedCredentialSlug: null,
          compatibleCredentialSlugs: ['openai-1', 'minimax-1'],
          injectableCredentialSlugs: ['openai-1', 'minimax-1'],
        },
      },
    }),
  ),
  // Credential detection — demo workspaces have no on-disk config, so report
  // none (no overwrite notice; the picker defaults to the first compatible).
  http.get('/api/workspaces/:id/agent-config/:agent/credential', () =>
    HttpResponse.json({ slug: null, model: null }),
  ),
  http.put('/api/workspaces/:id/agent-config/:agent', () => HttpResponse.json({ ok: true })),
  http.post('/api/workspaces/:id/agent-config/:agent/test', () =>
    HttpResponse.json({ ok: true, response: 'Demo mode — test is stubbed.' }),
  ),
]
