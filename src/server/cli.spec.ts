import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { ToolCenter } from '../core/tool-center.js'
import { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import { createThinkingTools } from '../tool/thinking.js'
import { inboxReadFactory } from '../tool/inbox-read.js'
import { workspacePathFactory } from '../tool/workspace-path.js'
import { createMemoryInboxStore } from '../core/inbox-store.js'
import { extractMcpShape } from '../core/mcp-export.js'
import { inboxPushFactory } from '../tool/inbox-push.js'
import { registerCliRoutes, type CliGatewayDeps } from './cli.js'

/**
 * End-to-end gateway test using the real `calculate` tool (no client deps), so
 * the validate -> execute -> unwrap path is exercised for real, not mocked.
 */
function makeApp(): Hono {
  const toolCenter = new ToolCenter()
  toolCenter.register(createThinkingTools(), 'thinking') // registers `calculate`

  const fakeSvc = {
    registry: {
      get: (id: string) => (id === 'ws1' ? { id: 'ws1', tag: 'demo' } : undefined),
    },
  }

  const deps: CliGatewayDeps = {
    toolCenter,
    workspaceToolCenter: new WorkspaceToolCenter(),
    inboxStore: {} as never,
    entityStore: {} as never,
    getWorkspaceService: () => fakeSvc as never,
  }

  const app = new Hono()
  registerCliRoutes(app, deps)
  return app
}

const app = makeApp()
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('CLI gateway — data export', () => {
  it('manifest lists grouped verbs with resolved tool names', async () => {
    const res = await app.request('/cli/ws1/data/manifest')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      export: string
      groups: Record<string, Record<string, { tool: string }>>
      unmapped: string[]
    }
    expect(body.export).toBe('data')
    expect(body.groups['think']?.['calc']?.tool).toBe('calculate')
  })

  it('manifest 404s on unknown workspace', async () => {
    const res = await app.request('/cli/nope/data/manifest')
    expect(res.status).toBe(404)
  })

  it('manifest 404s on unknown export', async () => {
    const res = await app.request('/cli/ws1/nope/manifest')
    expect(res.status).toBe(404)
  })

  it('invoke runs a mapped tool and returns its payload', async () => {
    const res = await post('/cli/ws1/data/invoke', { tool: 'calculate', args: { expression: '2 + 2' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { content: Array<{ type: string; text?: string }> }
    const text = body.content.map((b) => b.text ?? '').join('')
    expect(text).toContain('4')
  })

  it('invoke rejects a tool name not on the CLI map (e.g. trading)', async () => {
    const res = await post('/cli/ws1/data/invoke', { tool: 'placeOrder', args: {} })
    expect(res.status).toBe(404)
  })

  it('invoke 400s on invalid args', async () => {
    const res = await post('/cli/ws1/data/invoke', { tool: 'calculate', args: {} })
    expect(res.status).toBe(400)
  })

  it('invoke 400s LOUDLY on an unknown flag, naming the key', async () => {
    // Guards the silent-drop bug: a typo'd flag (--quantity for
    // --totalQuantity) was stripped by non-strict parsing, staging a
    // quantity-less order that validated clean.
    const res = await post('/cli/ws1/data/invoke', {
      tool: 'calculate',
      args: { expression: '1 + 1', expresion: 'typo' },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details?: string }
    expect(body.details).toMatch(/expresion/)
  })

  it('invoke 404s on unknown workspace', async () => {
    const res = await post('/cli/nope/data/invoke', { tool: 'calculate', args: { expression: '1' } })
    expect(res.status).toBe(404)
  })
})

describe('CLI gateway — export scope isolation', () => {
  it('the data export cannot reach a collaboration tool (inbox_push)', async () => {
    const res = await post('/cli/ws1/data/invoke', { tool: 'inbox_push', args: {} })
    expect(res.status).toBe(404) // not in the data map → gated out
  })

  it('the workspace export cannot reach a data tool (calculate)', async () => {
    const res = await post('/cli/ws1/workspace/invoke', { tool: 'calculate', args: { expression: '1' } })
    expect(res.status).toBe(404) // not in the workspace map → gated out
  })

  it('the workspace export manifest resolves (its own scope)', async () => {
    const res = await app.request('/cli/ws1/workspace/manifest')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { export: string; groups: Record<string, unknown> }
    expect(body.export).toBe('workspace')
    expect(typeof body.groups).toBe('object')
  })
})

describe('CLI gateway — inbox read (scoped, string-arg coercion)', () => {
  // A real workspace export wired with a memory inbox store, so the CLI shim's
  // all-strings args (`--self` -> 'true', `--limit 1` -> '1') exercise the
  // stringbool + number coercion through extractMcpShape + strictObject.
  async function makeWsApp(): Promise<Hono> {
    const inboxStore = createMemoryInboxStore()
    await inboxStore.append({ workspaceId: 'ws1', workspaceLabel: 'demo', comments: 'mine' })
    await inboxStore.append({ workspaceId: 'other', workspaceLabel: 'them', comments: 'theirs' })

    const wtc = new WorkspaceToolCenter()
    wtc.register(inboxReadFactory)

    const fakeSvc = { registry: { get: (id: string) => (id === 'ws1' ? { id: 'ws1', tag: 'demo' } : undefined) } }
    const app = new Hono()
    registerCliRoutes(app, {
      toolCenter: new ToolCenter(),
      workspaceToolCenter: wtc,
      inboxStore,
      entityStore: {} as never,
      getWorkspaceService: () => fakeSvc as never,
    })
    return app
  }

  const invoke = async (app: Hono, args: Record<string, string>) => {
    const res = await app.request('/cli/ws1/workspace/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'inbox_read', args }),
    })
    const body = (await res.json()) as { content?: Array<{ text?: string }>; error?: string }
    const payload = body.content ? JSON.parse(body.content.map((b) => b.text ?? '').join('')) : undefined
    return { status: res.status, body, payload }
  }

  it('`--self` (string "true") coerces and filters to this workspace', async () => {
    const app = await makeWsApp()
    const { status, payload } = await invoke(app, { self: 'true' })
    expect(status).toBe(200)
    expect(payload.count).toBe(1)
    expect(payload.entries[0].mine).toBe(true)
  })

  it('no flags returns the full cross-workspace stream', async () => {
    const app = await makeWsApp()
    const { status, payload } = await invoke(app, {})
    expect(status).toBe(200)
    expect(payload.count).toBe(2)
  })

  it('`--limit 1` (string "1") coerces to a number cap', async () => {
    const app = await makeWsApp()
    const { status, payload } = await invoke(app, { limit: '1' })
    expect(status).toBe(200)
    expect(payload.count).toBe(1)
    expect(payload.hasMore).toBe(true)
  })
})

describe('CLI gateway — agent-invisible origin (x-openalice-run → registry)', () => {
  // The `alice` shim forwards the spawn-injected AQ_RUN_ID as an `x-openalice-run`
  // header on /invoke. The gateway resolves it through the headless registry
  // (authoritative — issueId/agent come from the RECORD, not the request) and
  // stamps the resulting origin onto inbox_push, with NO origin param in the
  // tool's input schema.
  function makeOriginApp(inboxStore = createMemoryInboxStore()) {
    const fakeSvc = {
      registry: { get: (id: string) => (id === 'ws1' ? { id: 'ws1', tag: 'demo', dir: '/wsroot/ws1' } : undefined) },
      headlessTasks: {
        get: (taskId: string) =>
          taskId === 'run-7'
            ? { taskId: 'run-7', issueId: 'macro-scan', agent: 'opencode' }
            : null,
      },
    }
    const wtc = new WorkspaceToolCenter()
    wtc.register(inboxPushFactory)
    const app = new Hono()
    registerCliRoutes(app, {
      toolCenter: new ToolCenter(),
      workspaceToolCenter: wtc,
      inboxStore,
      entityStore: {} as never,
      getWorkspaceService: () => fakeSvc as never,
    })
    return { app, inboxStore }
  }

  const pushWith = (app: Hono, headers: Record<string, string>) =>
    app.request('/cli/ws1/workspace/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ tool: 'inbox_push', args: { comments: 'report' } }),
    })

  it('stamps origin from the registry record when the run header is present', async () => {
    const { app, inboxStore } = makeOriginApp()
    const res = await pushWith(app, { 'x-openalice-run': 'run-7' })
    expect(res.status).toBe(200)
    const { entries } = await inboxStore.read({ workspaceId: 'ws1' })
    expect(entries[0].origin).toEqual({
      kind: 'headless',
      runId: 'run-7',
      issueId: 'macro-scan',
      agent: 'opencode',
    })
  })

  it('no header → no origin (the interactive case)', async () => {
    const { app, inboxStore } = makeOriginApp()
    await pushWith(app, {})
    const { entries } = await inboxStore.read({ workspaceId: 'ws1' })
    expect(entries[0].origin).toBeUndefined()
  })

  it('an unknown run id resolves to no origin (forged/stale value can not fabricate a link)', async () => {
    const { app, inboxStore } = makeOriginApp()
    await pushWith(app, { 'x-openalice-run': 'ghost' })
    const { entries } = await inboxStore.read({ workspaceId: 'ws1' })
    expect(entries[0].origin).toBeUndefined()
  })

  it('inbox_push input schema has NO origin / runId / issueId param (agent never self-identifies)', () => {
    const built = inboxPushFactory.build({
      workspaceId: 'ws1',
      workspaceLabel: 'demo',
      inboxStore: createMemoryInboxStore(),
      entityStore: {} as never,
    })
    // The tool's input schema keys must be exactly the two content fields —
    // never a self-identity parameter.
    const keys = Object.keys(extractMcpShape(built))
    expect(keys.sort()).toEqual(['comments', 'docs'])
    expect(keys).not.toContain('origin')
    expect(keys).not.toContain('runId')
    expect(keys).not.toContain('issueId')
  })
})

describe('CLI gateway — peer path (cross-workspace resolution)', () => {
  // The /cli gateway threads a resolveWorkspace closure (over getWorkspaceService)
  // into the workspace ctx, so workspace_path can resolve a PEER's dir — not just
  // the caller's. Registry here knows two workspaces: the caller ws1 and a peer.
  function makePeerApp(): Hono {
    const REG: Record<string, { id: string; tag: string; dir: string }> = {
      ws1: { id: 'ws1', tag: 'caller', dir: '/wsroot/ws1' },
      ws2: { id: 'ws2', tag: 'Quant Lab', dir: '/wsroot/ws2' },
    }
    const fakeSvc = { registry: { get: (id: string) => REG[id] } }

    const wtc = new WorkspaceToolCenter()
    wtc.register(workspacePathFactory)

    const app = new Hono()
    registerCliRoutes(app, {
      toolCenter: new ToolCenter(),
      workspaceToolCenter: wtc,
      inboxStore: {} as never,
      entityStore: {} as never,
      getWorkspaceService: () => fakeSvc as never,
    })
    return app
  }

  const invoke = async (app: Hono, args: Record<string, string>) => {
    const res = await app.request('/cli/ws1/workspace/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'workspace_path', args }),
    })
    const body = (await res.json()) as { content?: Array<{ text?: string }>; error?: string }
    const payload = body.content ? JSON.parse(body.content.map((b) => b.text ?? '').join('')) : undefined
    return { status: res.status, payload }
  }

  it('manifest renders the peer/path verb mapped to workspace_path (--help discovery)', async () => {
    const res = await makePeerApp().request('/cli/ws1/workspace/manifest')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      groups: Record<string, Record<string, { tool: string }>>
      unmapped: string[]
    }
    expect(body.groups['peer']?.['path']?.tool).toBe('workspace_path')
    // it's mapped, so it must NOT appear in the no-silent-caps unmapped list
    expect(body.unmapped).not.toContain('workspace_path')
  })

  it('resolves a PEER workspace dir from inside another workspace (ws1 -> ws2)', async () => {
    const { status, payload } = await invoke(makePeerApp(), { id: 'ws2' })
    expect(status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.path).toBe('/wsroot/ws2')
    expect(payload.tag).toBe('Quant Lab')
  })

  it('returns ok:false (not a throw) for an unknown peer id', async () => {
    // The tool returns a structured {ok:false} value rather than throwing, so
    // the gateway responds 200 with that payload — not a 500.
    const { status, payload } = await invoke(makePeerApp(), { id: 'ghost' })
    expect(status).toBe(200)
    expect(payload.ok).toBe(false)
    expect(payload.error).toMatch(/unknown workspace/)
  })
})
