import type { Hono } from 'hono'
import { readWorkspaceBinaryFile } from '../workspaces/binary-file.js'

/** Mounted on the existing loopback tool listener, never a public bypass. */
export function registerWorkspaceFileRoutes(app: Hono, resolveWorkspace: (id: string) => { dir: string } | undefined): void {
  app.get('/cli/workspace-files/:id', async c => {
    c.header('Cache-Control', 'no-store')
    const workspace = resolveWorkspace(c.req.param('id'))
    if (!workspace) return c.json({ error: 'workspace_unavailable' }, 404)
    try {
      const file = await readWorkspaceBinaryFile(workspace.dir, c.req.query('path') ?? '')
      return c.json({ filename: file.filename, contentBase64: file.content.toString('base64') })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return c.json({ error: ['invalid_path', 'not_regular_file', 'file_too_large'].includes(code) ? code : 'file_unavailable' }, 400)
    }
  })
}
