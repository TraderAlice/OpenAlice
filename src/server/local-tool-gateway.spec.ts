import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { useToolToken } from './local-tool-gateway.js'

it('requires the spawn token on /cli and /mcp and leaves /api alone', async () => {
  const previous = process.env['OPENALICE_TOOL_TOKEN']
  process.env['OPENALICE_TOOL_TOKEN'] = 'test-token'
  try {
    const app = new Hono()
    useToolToken(app)
    app.post('/cli/ws/data/invoke', c => c.json({ ok: true }))
    app.post('/mcp', c => c.json({ ok: true }))
    app.get('/api/version', c => c.json({ ok: true }))
    expect((await app.request('/cli/ws/data/invoke', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/mcp', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/api/version')).status).toBe(200)
    const ok = await app.request('/cli/ws/data/invoke', { method: 'POST', headers: { Authorization: 'Bearer test-token' } })
    expect(ok.status).toBe(200)
  } finally {
    if (previous === undefined) delete process.env['OPENALICE_TOOL_TOKEN']
    else process.env['OPENALICE_TOOL_TOKEN'] = previous
  }
})
