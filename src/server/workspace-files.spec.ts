import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { registerWorkspaceFileRoutes } from './workspace-files.js'

it('serves exact binary bytes and refuses missing, escaping, symlink and oversized files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reply-files-'))
  const outside = await mkdtemp(join(tmpdir(), 'reply-outside-'))
  try {
    await writeFile(join(root, 'report.pdf'), Buffer.from([0, 255, 42]))
    await writeFile(join(outside, 'secret'), 'private')
    await symlink(join(outside, 'secret'), join(root, 'escape'))
    await writeFile(join(root, 'big'), Buffer.alloc(1024 * 1024 + 1))
    const app = new Hono()
    registerWorkspaceFileRoutes(app, id => id === 'ws' ? { dir: root } : undefined)
    const res = await app.request('/cli/workspace-files/ws?path=report.pdf')
    expect(await res.json()).toEqual({ filename: 'report.pdf', contentBase64: 'AP8q' })
    for (const path of ['../secret', '/etc/passwd', 'escape', 'missing', '.', 'big']) {
      expect((await app.request(`/cli/workspace-files/ws?path=${encodeURIComponent(path)}`)).status).toBe(400)
    }
    expect((await app.request('/cli/workspace-files/absent?path=report.pdf')).status).toBe(404)
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
