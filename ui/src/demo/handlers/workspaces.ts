import { http, HttpResponse } from 'msw'
import { demoChatWorkspace, demoWorkspaces, demoTemplates } from '../fixtures/workspaces'
import { demoWorkspaceFiles } from '../fixtures/inbox'
import type { DepartedWorkspace, WorkspaceMetadataPatch } from '../../components/workspace/api'

const demoDepartedWorkspaces: DepartedWorkspace[] = [{
  id: 'chat-quiet-slate-archive',
  tag: 'macro-research-archive',
  activeDir: '/demo/workspaces/chat-quiet-slate-archive',
  departedDir: '/demo/departed-workspaces/chat-quiet-slate-archive',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-07-11T08:30:00.000Z',
  departedAt: '2026-07-11T08:30:00.000Z',
  lifecycle: 'departed' as const,
  reason: 'Research mandate moved to the durable macro desk.',
  handoff: {
    preparedAt: '2026-07-11T08:30:00.000Z',
    dirtyFiles: [' M research/rates.md'],
    openIssueIds: ['review-fed-regime'],
    scheduledIssueIds: [],
    resumeIds: ['resume-quiet-slate-owner'],
    sessionRecords: 1,
  },
}]

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
  http.get('/api/workspaces/departed', () => HttpResponse.json({ workspaces: demoDepartedWorkspaces })),
  http.post('/api/workspaces/departed/:id/restore', ({ params }) => {
    const index = demoDepartedWorkspaces.findIndex((workspace) => workspace.id === String(params.id))
    if (index < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    demoDepartedWorkspaces.splice(index, 1)
    return HttpResponse.json({ ok: true })
  }),
  http.delete('/api/workspaces/departed/:id', ({ params }) => {
    const workspace = demoDepartedWorkspaces.find((candidate) => candidate.id === String(params.id))
    if (!workspace) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    Object.assign(workspace, { lifecycle: 'purged', purgedAt: new Date().toISOString() })
    return HttpResponse.json({ ok: true })
  }),
  http.post('/api/workspaces', () =>
    HttpResponse.json(
      { ok: false, status: 400, error: { error: 'bootstrap_failed', message: 'Demo mode — workspace creation is disabled.' } },
      { status: 400 },
    ),
  ),
  http.get('/api/workspaces/:id/offboarding', ({ params }) => {
    const workspace = demoWorkspaces.find((candidate) => candidate.id === String(params.id))
    if (!workspace) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const resumeIds = workspace.sessions.map((session) => session.resumeId)
    return HttpResponse.json({
      assessment: {
        workspace: { id: workspace.id, tag: workspace.tag, dir: `/demo/workspaces/${workspace.id}` },
        canOffboard: true,
        blockers: [],
        runningHeadless: [],
        untrackedHeadlessActive: false,
        runningSessions: workspace.sessions.filter((session) => session.state === 'running').length,
        sessionRecords: workspace.sessions.length,
        resumeIds,
        openIssueIds: ['review-current-thesis'],
        scheduledIssueIds: [],
        git: { branch: 'main', clean: false, files: [{ status: ' M', path: 'research/latest.md' }] },
      },
    })
  }),
  http.post('/api/workspaces/:id/offboard', async ({ params, request }) => {
    const index = demoWorkspaces.findIndex((candidate) => candidate.id === String(params.id))
    if (index < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const workspace = demoWorkspaces[index]!
    const body = await request.json().catch(() => ({})) as { reason?: string; notes?: string }
    const now = new Date().toISOString()
    demoWorkspaces.splice(index, 1)
    demoDepartedWorkspaces.unshift({
      id: workspace.id,
      tag: workspace.tag,
      activeDir: `/demo/workspaces/${workspace.id}`,
      departedDir: `/demo/departed-workspaces/${workspace.id}`,
      createdAt: workspace.createdAt,
      updatedAt: now,
      departedAt: now,
      lifecycle: 'departed',
      reason: body.reason ?? 'Offboarded in demo mode',
      handoff: {
        preparedAt: now,
        ...(body.notes ? { notes: body.notes } : {}),
        dirtyFiles: [' M research/latest.md'],
        openIssueIds: ['review-current-thesis'],
        scheduledIssueIds: [],
        resumeIds: workspace.sessions.map((session) => session.resumeId),
        sessionRecords: workspace.sessions.length,
      },
    })
    return HttpResponse.json({ ok: true })
  }),
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
  http.get('/api/agent-runtimes/readiness', () =>
    HttpResponse.json(demoAgentRuntimeReadiness),
  ),
  http.post('/api/agent-runtimes/readiness/probe', () =>
    HttpResponse.json({
      probeId: 'demo-runtime-probe',
      agents: Object.keys(demoAgentRuntimeReadiness.agents),
      snapshot: demoAgentRuntimeReadiness,
    }, { status: 202 }),
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
      resumeId: 'demo-resume-spawn',
      title: null,
    }),
  ),
  http.get('/api/workspaces/signatures/:resumeId', ({ params }) => {
    const resumeId = String(params.resumeId)
    const workspace = demoWorkspaces.find((candidate) =>
      candidate.sessions.some((session) => session.resumeId === resumeId),
    ) ?? (resumeId === 'resume-demo-thesis-owner'
      ? demoWorkspaces.find((candidate) => candidate.id === 'demo-ws-auto-quant')
      : undefined)
    if (!workspace) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const session = workspace.sessions.find((candidate) => candidate.resumeId === resumeId)
    return HttpResponse.json({
      signature: `@${resumeId}`,
      resumeId,
      workspaceId: workspace.id,
      agent: session?.agent ?? 'claude',
      lifecycle: 'active',
      resumable: true,
    })
  }),
  http.get('/api/workspaces/:id/resumes', ({ params }) => {
    const wsId = String(params.id)
    if (wsId === 'demo-ws-auto-quant') {
      return HttpResponse.json({
        workspace: { id: wsId, tag: 'auto-quant' },
        sessions: [{
          resumeId: 'resume-demo-thesis-owner', agent: 'claude',
          createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 60_000,
          lifecycle: 'active', resumable: true, active: false,
          latestExecution: {
            taskId: 'demo-thesis-owner-run', status: 'done',
            startedAt: Date.now() - 60_000,
            assistantPreview: 'Reviewed the active thesis invalidation rules.',
          },
        }],
      })
    }
    const workspace = demoWorkspaces.find((candidate) => candidate.id === wsId)
    return HttpResponse.json({
      workspace: { id: wsId, tag: workspace?.tag ?? wsId },
      sessions: (workspace?.sessions ?? []).map((session) => ({
        resumeId: session.resumeId,
        agent: session.agent,
        createdAt: Date.parse(session.createdAt),
        updatedAt: Date.parse(session.lastActiveAt),
        lifecycle: 'active',
        resumable: session.agent !== 'shell',
        active: session.state === 'running',
        interactive: {
          name: session.name,
          ...(session.title ? { title: session.title } : {}),
          state: session.state,
          lastActiveAt: session.lastActiveAt,
        },
      })),
    })
  }),
  http.post('/api/workspaces/:id/resumes/:resumeId/session', ({ params }) => {
    const wsId = String(params.id)
    const resumeId = String(params.resumeId)
    const workspace = demoWorkspaces.find((candidate) => candidate.id === wsId)
    if (!workspace) return HttpResponse.json({ error: 'workspace_not_found' }, { status: 404 })
    const existing = workspace.sessions.find((session) => session.resumeId === resumeId)
    if (existing) return HttpResponse.json({ session: existing, created: false })
    const now = new Date().toISOString()
    const session = {
      id: `run-${resumeId}`,
      resumeId,
      wsId,
      agent: 'codex',
      name: `x${workspace.sessions.length + 1}`,
      createdAt: now,
      lastActiveAt: now,
      state: 'running' as const,
      pid: 0,
      startedAt: Date.now(),
      title: 'Compute a quant snapshot of NVDA and push a report to the inbox.',
      sourceRunId: 'demo-headless-1',
    }
    ;(workspace.sessions as Array<typeof session>).push(session)
    return HttpResponse.json({ session, created: true }, { status: 201 })
  }),

  // Quick-chat launch — honor an explicit Chat Workspace target and otherwise
  // reuse the recent demo Chat workspace. The terminal is a scripted replay.
  http.post('/api/workspaces/quick-chat', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { targetWsId?: unknown } | null
    const explicit = typeof body?.targetWsId === 'string'
      ? demoWorkspaces.find((workspace) => workspace.id === body.targetWsId)
      : undefined
    const ws = explicit ?? demoChatWorkspace
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
          resumeId: 'demo-resume-quick-chat',
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
