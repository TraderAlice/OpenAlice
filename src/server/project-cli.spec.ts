import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveAliceProjectIdentity } from '@traderalice/guardian-runtime'
import { userDataHome } from '../core/paths.js'
import { ToolCenter } from '../core/tool-center.js'
import { registerProjectCliRoutes } from './project-cli.js'

const projectId = resolveAliceProjectIdentity({ home: userDataHome }).id
function fixture() {
  const app = new Hono()
  const center = new ToolCenter()
  const execute = vi.fn(({ query }: { query: string }) => ({ query }))
  center.register({
    marketSearchForResearch: tool({ inputSchema: z.object({ query: z.string() }), execute }),
    workspace_path: tool({ inputSchema: z.object({}), execute: (): { path: string } => { throw new Error('scoped tool leaked') } }),
  }, 'fixture')
  registerProjectCliRoutes(app, center)
  return { app, execute }
}
describe('Project CLI boundary', () => {
  it('requires selected Project identity on discovery and invocation', async () => {
    const { app, execute } = fixture()
    for (const path of ['manifest', 'invoke']) {
      const response = await app.request(`/cli/project/data/${path}`, { method: path === 'manifest' ? 'GET' : 'POST', headers: { 'x-openalice-project': 'wrong-project' } })
      expect(response.status).toBe(409)
    }
    expect(execute).not.toHaveBeenCalled()
  })
  it('exposes global commands without creating a Workspace', async () => {
    const { app } = fixture()
    const response = await app.request('/cli/project/data/manifest', { headers: { 'x-openalice-project': projectId } })
    const manifest = await response.json()
    expect(manifest.groups.market.search.tool).toBe('marketSearchForResearch')
    expect(manifest.groups.workspace).toBeUndefined()
  })
  it('rejects scoped commands and unknown arguments, even with forged Session headers', async () => {
    const { app, execute } = fixture()
    const request = (body: unknown) => app.request('/cli/project/data/invoke', { method: 'POST', headers: { 'x-openalice-project': projectId, 'content-type': 'application/json', 'x-openalice-session': 'forged' }, body: JSON.stringify(body) })
    expect((await request({ tool: 'workspace_path', args: {} })).status).toBe(404)
    expect((await request({ tool: 'marketSearchForResearch', args: { query: 'AAPL', extra: true } })).status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
    expect((await request({ tool: 'marketSearchForResearch', args: { query: 'AAPL' } })).status).toBe(200)
    expect(execute).toHaveBeenCalledOnce()
  })
})
