import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { ToolCenter } from '../core/tool-center.js'
import { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import { createThinkingTools } from '../tool/thinking.js'
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
