import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, expect, it, vi } from 'vitest'
import { registerWorkspaceFileRoutes } from '../../../../src/server/workspace-files.js'
import { fetchWorkspaceAttachment, fetchAliceJson } from './workspace-files.js'

afterEach(() => vi.unstubAllEnvs())
for (const socket of [false, true]) it(`reads a real Workspace file over ${socket ? 'socket' : 'HTTP'} without Inbox`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-file-wire-'))
  const app = new Hono()
  registerWorkspaceFileRoutes(app, id => id === 'workspace' ? { dir: root } : undefined)
  const server = createServer(async (req, res) => {
    const response = await app.request(req.url!)
    res.writeHead(response.status, { 'content-type': 'application/json' })
    res.end(await response.text())
  })
  try {
    await writeFile(join(root, '图表.png'), Buffer.from([137, 80, 78, 71]))
    await new Promise<void>(resolve => socket ? server.listen(join(root, 'tool.sock'), resolve) : server.listen(0, '127.0.0.1', resolve))
    if (socket) vi.stubEnv('OPENALICE_TOOL_SOCKET', join(root, 'tool.sock'))
    else {
      vi.stubEnv('OPENALICE_TOOL_SOCKET', '')
      vi.stubEnv('OPENALICE_MCP_PORT', String((server.address() as { port: number }).port))
    }
    const file = await fetchWorkspaceAttachment('workspace', '图表.png')
    expect(file).toMatchObject({ filename: '图表.png', mediaType: 'image/png', sizeBytes: 4, contentBase64: 'iVBORw==' })
    await expect(fetchWorkspaceAttachment('workspace', '../outside')).rejects.toThrow('unavailable')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})

for (const socket of [false, true]) it(`posts Session controls over ${socket ? 'socket' : 'HTTP'} and preserves actionable errors`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-model-wire-'))
  const requests: unknown[] = []
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    expect(req.method).toBe('POST')
    res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Session changed. Reopen /model.' }))
  })
  try {
    await new Promise<void>(resolve => socket ? server.listen(join(root, 'tool.sock'), resolve) : server.listen(0, '127.0.0.1', resolve))
    vi.stubEnv('OPENALICE_TOOL_SOCKET', socket ? join(root, 'tool.sock') : '')
    if (!socket) vi.stubEnv('OPENALICE_MCP_PORT', String((server.address() as { port: number }).port))
    await expect(fetchAliceJson('/cli/connector-model/telegram', { apply: true })).rejects.toThrow('Session changed')
    expect(requests).toEqual([{ apply: true }])
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
