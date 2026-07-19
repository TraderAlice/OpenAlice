import { http, HttpResponse } from 'msw'
import { demoChatWorkspace, demoWorkspaces, demoTemplates } from '../fixtures/workspaces'
import { demoWorkspaceFiles } from '../fixtures/inbox'
import type {
  AgentConfig,
  AgentConfigBundle,
  AgentId,
  DepartedWorkspace,
  WorkspaceMetadataPatch,
} from '../../components/workspace/api'

const demoManagerSession = {
  id: 'demo-manager-session',
  resumeId: 'demo-resume-manager',
  wsId: 'workspace-manager',
  agent: 'pi',
  name: 'p1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  state: 'running' as const,
  surface: 'webpi' as const,
  pid: 0,
  startedAt: Date.now(),
  title: 'Audit the active Workspace floor',
}

let demoManagerMessages: unknown[] = []

// Demo mutations live only for the current MSW worker lifetime. Keeping agent
// config state here lets the real Settings -> save event -> Quick Start refresh
// path be exercised without touching a user's Workspace files.
const demoAgentConfigs = new Map<string, Partial<Record<AgentId, AgentConfig>>>()

function demoAgentConfigBundle(workspaceId: string): AgentConfigBundle {
  const saved = demoAgentConfigs.get(workspaceId)
  return {
    claude: saved?.claude ?? null,
    codex: saved?.codex ?? null,
    opencode: saved?.opencode ?? null,
    pi: saved?.pi ?? null,
  }
}

function demoManagerSnapshot() {
  return {
    recordId: demoManagerSession.id,
    wsId: demoManagerSession.wsId,
    resumeId: demoManagerSession.resumeId,
    pid: 0,
    startedAt: demoManagerSession.startedAt,
    phase: 'idle' as const,
    state: null,
    messages: demoManagerMessages,
    streamingMessage: null,
    error: null,
    stderrTail: '',
    revision: demoManagerMessages.length,
  }
}

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

const demoTemplateUpgradePlan = (workspaceId: string) => ({
  workspaceId,
  template: 'chat',
  fromVersion: '0.1.0',
  toVersion: '0.2.0',
  strategy: 'managed-context' as const,
  planDigest: 'demo-template-upgrade-plan',
  source: 'legacy-root-commit' as const,
  blocked: false,
  blockers: [],
  activity: { busy: false, sessions: [], headless: [] },
  files: [
    {
      path: 'README.md', status: 'ready', operation: 'update', canUseTemplate: true,
      currentPreview: '# Chat workspace\n\nUse the OpenAlice CLI.',
      templatePreview: '# Chat workspace\n\nUse the OpenAlice CLI and sign durable work.',
      currentTruncated: false, templateTruncated: false,
    },
    {
      path: '.agents/skills/alice-workspace/SKILL.md', status: 'ready', operation: 'update', canUseTemplate: true,
      currentPreview: 'Old collaboration guidance.', templatePreview: 'Current collaboration guidance.',
      currentTruncated: false, templateTruncated: false,
    },
    {
      path: 'AGENTS.md', status: 'preserved', operation: 'keep', canUseTemplate: true,
      currentPreview: 'Workspace-specific desk instructions.', templatePreview: 'Template desk instructions.',
      currentTruncated: false, templateTruncated: false,
      note: 'Changed only in this Workspace; it will stay as-is.',
    },
    {
      path: '.claude/skills/self-scheduling/SKILL.md', status: 'conflict', operation: 'update', canUseTemplate: true,
      currentPreview: 'Report scheduled work to the owner with the local checklist.',
      templatePreview: 'Report scheduled work to Inbox with a signed artifact.',
      currentTruncated: false, templateTruncated: false,
      note: 'Both the Workspace and template changed this file.',
    },
  ],
  summary: { ready: 2, preserved: 1, conflicts: 1, unchanged: 0 },
})

export const workspacesHandlers = [
  http.put('/api/workspaces/terminal-view-attributes', () =>
    HttpResponse.json({ ok: true, changed: true })),
  http.get('/api/workspaces', () => HttpResponse.json({ workspaces: demoWorkspaces })),
  http.get('/api/workspaces/manager', () => HttpResponse.json({
    manager: {
      id: 'workspace-manager', tag: 'Workspace Manager',
      activeWorkspaceCount: demoWorkspaces.length,
      sessions: demoManagerMessages.length > 0 ? [demoManagerSession] : [],
    },
  })),
  http.post('/api/workspaces/manager/quick-start', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { prompt?: string }
    demoManagerMessages = [
      { role: 'user', content: body.prompt ?? 'Audit the active Workspace floor.' },
      { role: 'assistant', content: 'Demo manager: active desks are inventoried and ready for coordination.' },
    ]
    return HttpResponse.json({
      manager: {
        id: 'workspace-manager', tag: 'Workspace Manager',
        activeWorkspaceCount: demoWorkspaces.length, sessions: [demoManagerSession],
      },
      session: demoManagerSession,
      snapshot: demoManagerSnapshot(),
    }, { status: 201 })
  }),
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
  http.get('/api/workspaces/:id/template-upgrade', ({ params }) => {
    const workspace = demoWorkspaces.find((candidate) => candidate.id === String(params.id))
    if (!workspace) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    if (!workspace.upgradeAvailable) {
      return HttpResponse.json({
        plan: {
          ...demoTemplateUpgradePlan(workspace.id),
          fromVersion: workspace.currentVersion ?? '0.2.0',
          toVersion: workspace.currentVersion ?? '0.2.0',
          source: 'recorded-baseline',
          files: [],
          summary: { ready: 0, preserved: 0, conflicts: 0, unchanged: 0 },
        },
      })
    }
    return HttpResponse.json({ plan: demoTemplateUpgradePlan(workspace.id) })
  }),
  http.post('/api/workspaces/:id/template-upgrade', async ({ params, request }) => {
    const workspace = demoWorkspaces.find((candidate) => candidate.id === String(params.id))
    if (!workspace) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const body = await request.json().catch(() => ({})) as {
      planDigest?: string
      resolutions?: Record<string, string>
    }
    if (body.planDigest !== 'demo-template-upgrade-plan') {
      return HttpResponse.json({ error: 'stale_plan', message: 'Refresh the preview.' }, { status: 409 })
    }
    if (!body.resolutions?.['.claude/skills/self-scheduling/SKILL.md']) {
      return HttpResponse.json({ error: 'unresolved_conflict', message: 'Choose a copy first.' }, { status: 400 })
    }
    ;(workspace as { currentVersion?: string; upgradeAvailable?: { from: string; to: string } | null }).currentVersion = '0.2.0'
    ;(workspace as { currentVersion?: string; upgradeAvailable?: { from: string; to: string } | null }).upgradeAvailable = null
    return HttpResponse.json({
      result: {
        workspaceId: workspace.id,
        fromVersion: '0.1.0',
        toVersion: '0.2.0',
        commit: 'd3m0c0de12345678',
        changedPaths: ['README.md', '.agents/skills/alice-workspace/SKILL.md'],
        keptPaths: ['AGENTS.md'],
      },
      workspace,
    })
  }),
  http.get('/api/workspaces/:id/absorb/:sourceId', ({ params }) => {
    const target = demoWorkspaces.find((candidate) => candidate.id === String(params.id))
    const source = demoWorkspaces.find((candidate) => candidate.id === String(params.sourceId))
    if (!target || !source || target.id === source.id) {
      return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return HttpResponse.json({
      plan: {
        source: { id: source.id, tag: source.tag, displayName: source.displayName },
        target: { id: target.id, tag: target.tag, displayName: target.displayName },
        importRoot: `imports/${source.tag}-${source.id.slice(-6)}`,
        planDigest: `demo-absorb-${target.id}-${source.id}`,
        blocked: false,
        blockers: [],
        activity: {
          source: { busy: false, sessions: [], headless: [] },
          target: { busy: false, sessions: [], headless: [] },
        },
        sourceInventory: {
          sessions: source.sessions.length,
          resumeIds: source.sessions.length,
          openIssues: ['review-source-thesis'],
          scheduledIssues: ['daily-source-scan'],
          dirtyFiles: 2,
        },
        files: [
          {
            path: 'research/source-thesis.md', status: 'ready', operation: 'add',
            sourcePreview: '# Source thesis\n\nReviewed research from the source desk.', targetPreview: null,
            sourceTruncated: false, targetTruncated: false, sourceSize: 82, targetSize: null,
            canUseSource: true, keepBothPath: `imports/${source.tag}-${source.id.slice(-6)}/research/source-thesis.md`,
          },
          {
            path: 'research/watchlist.md', status: 'conflict', operation: 'choose',
            sourcePreview: '# Watchlist\n\nNVDA, TSM, MU', targetPreview: '# Watchlist\n\nSPY, QQQ, IWM',
            sourceTruncated: false, targetTruncated: false, sourceSize: 28, targetSize: 29,
            canUseSource: true, keepBothPath: `imports/${source.tag}-${source.id.slice(-6)}/research/watchlist.md`,
          },
          {
            path: 'research/market-conventions.md', status: 'duplicate', operation: 'skip',
            sourcePreview: '# Market conventions', targetPreview: '# Market conventions',
            sourceTruncated: false, targetTruncated: false, sourceSize: 20, targetSize: 20,
            canUseSource: true, keepBothPath: `imports/${source.tag}-${source.id.slice(-6)}/research/market-conventions.md`,
          },
        ],
        summary: { ready: 1, duplicates: 1, conflicts: 1, excluded: 12, bytes: 130 },
      },
    })
  }),
  http.post('/api/workspaces/:id/absorb/:sourceId', async ({ params, request }) => {
    const target = demoWorkspaces.find((candidate) => candidate.id === String(params.id))
    const sourceIndex = demoWorkspaces.findIndex((candidate) => candidate.id === String(params.sourceId))
    if (!target || sourceIndex < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const source = demoWorkspaces[sourceIndex]!
    const body = await request.json().catch(() => ({})) as {
      planDigest?: string
      resolutions?: Record<string, string>
    }
    if (body.planDigest !== `demo-absorb-${target.id}-${source.id}`) {
      return HttpResponse.json({ error: 'stale_plan', message: 'Review the refreshed plan.' }, { status: 409 })
    }
    if (!body.resolutions?.['research/watchlist.md']) {
      return HttpResponse.json({ error: 'unresolved_conflict', message: 'Choose how to keep research/watchlist.md.' }, { status: 400 })
    }
    const now = new Date().toISOString()
    demoWorkspaces.splice(sourceIndex, 1)
    demoDepartedWorkspaces.unshift({
      id: source.id,
      tag: source.tag,
      activeDir: `/demo/workspaces/${source.id}`,
      departedDir: `/demo/departed-workspaces/${source.id}`,
      createdAt: source.createdAt,
      updatedAt: now,
      departedAt: now,
      absorbedAt: now,
      absorbedIntoWorkspaceId: target.id,
      absorbCommit: 'ab50bed123456789',
      lifecycle: 'departed',
      reason: `Absorbed into ${target.tag}`,
      handoff: {
        preparedAt: now,
        dirtyFiles: [' M research/source-thesis.md'],
        openIssueIds: ['review-source-thesis'],
        scheduledIssueIds: ['daily-source-scan'],
        resumeIds: source.sessions.map((session) => session.resumeId),
        sessionRecords: source.sessions.length,
      },
    })
    return HttpResponse.json({
      result: {
        sourceWorkspaceId: source.id,
        targetWorkspaceId: target.id,
        commit: 'ab50bed123456789',
        changedPaths: ['research/source-thesis.md', 'imports/source/research/watchlist.md'],
        skippedPaths: ['research/market-conventions.md'],
        departedDir: `/demo/departed-workspaces/${source.id}`,
      },
      workspace: target,
    })
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
        { slug: 'openai-1', vendor: 'openai', label: 'OpenAI', authType: 'api-key', wires: { 'openai-chat': 'https://api.openai.com/v1' }, lastModel: 'gpt-5.6', resolvedModel: 'gpt-5.6', apiKey: 'demo-openai-key-not-secret' },
        { slug: 'minimax-1', vendor: 'minimax', label: 'MiniMax', authType: 'api-key', wires: { 'openai-chat': 'https://api.minimax.io/v1' }, lastModel: 'MiniMax-M2.1', resolvedModel: 'MiniMax-M2.1', apiKey: 'demo-minimax-key-not-secret' },
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
  http.delete('/api/workspaces/:id/sessions/:sid', ({ params }) => {
    const workspaceIndex = demoWorkspaces.findIndex((candidate) => candidate.id === String(params.id))
    const workspace = demoWorkspaces[workspaceIndex]
    if (workspace) {
      demoWorkspaces[workspaceIndex] = {
        ...workspace,
        sessions: workspace.sessions.filter((session) => session.id !== String(params.sid)),
      }
    }
    return HttpResponse.json(true)
  }),
  http.get('/api/workspaces/:id/sessions/:sid/diagnostics', () =>
    HttpResponse.json({ status: 'demo' }),
  ),
  http.post('/api/workspaces/:id/sessions/:sid/webpi/open', () =>
    HttpResponse.json({ snapshot: demoManagerSnapshot() })),
  http.get('/api/workspaces/:id/sessions/:sid/webpi', () =>
    HttpResponse.json({ snapshot: demoManagerSnapshot() })),
  http.post('/api/workspaces/:id/sessions/:sid/webpi/prompt', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { message?: string }
    demoManagerMessages = [
      ...demoManagerMessages,
      { role: 'user', content: body.message ?? '' },
      { role: 'assistant', content: 'Demo manager: I would inspect the live CLI indexes before changing any desk.' },
    ]
    return HttpResponse.json({ snapshot: demoManagerSnapshot() })
  }),
  http.post('/api/workspaces/:id/sessions/:sid/webpi/abort', () =>
    HttpResponse.json({ snapshot: demoManagerSnapshot() })),

  http.get('/api/workspaces/:id/agent-config', ({ params }) =>
    HttpResponse.json(demoAgentConfigBundle(String(params.id)))),
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
  http.get('/api/workspaces/:id/agent-config/:agent/credential', ({ params }) => {
    const workspaceId = String(params.id)
    const agent = String(params.agent) as AgentId
    const config = demoAgentConfigs.get(workspaceId)?.[agent]
    const configured = Boolean(config?.baseUrl && config.apiKey && config.model)
    const baseUrl = config?.baseUrl ?? ''
    const slug = baseUrl.includes('api.openai.com')
      ? 'openai-1'
      : baseUrl.includes('api.minimax.io')
        ? 'minimax-1'
        : null
    return HttpResponse.json({
      configured,
      slug: configured ? slug : null,
      model: configured ? config?.model ?? null : null,
      contextWindow: configured ? config?.contextWindow ?? null : null,
      wireShape: configured ? config?.wireShape ?? null : null,
      reasoning: configured ? config?.reasoning ?? null : null,
      reasoningEffort: configured ? config?.reasoningEffort ?? null : null,
    })
  }),
  http.put('/api/workspaces/:id/agent-config/:agent', async ({ params, request }) => {
    const workspaceId = String(params.id)
    const agent = String(params.agent) as AgentId
    const config = await request.json() as AgentConfig
    demoAgentConfigs.set(workspaceId, {
      ...demoAgentConfigs.get(workspaceId),
      [agent]: config,
    })
    return HttpResponse.json({ ok: true })
  }),
  http.post('/api/workspaces/:id/agent-config/:agent/test', () =>
    HttpResponse.json({ ok: true, response: 'Demo mode — test is stubbed.' }),
  ),
]
