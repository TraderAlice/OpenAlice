import { getResponse } from 'msw'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { handlers } from './handlers/index'
import { catchAllHandlers } from './handlers/catchAll'
import { demoWorkspaces } from './fixtures/workspaces'
import { demoWorkspaceFiles, demoWorkspaceFilePaths } from './fixtures/inbox'

// No network listener or fetch interception. Every API request is resolved
// directly against the shared fixtures; missing coverage fails closed.
const apiHandlers = handlers.filter(handler => !catchAllHandlers.includes(handler))
const uiRoot = resolve(process.env.OPENALICE_DEMO_UI!)
const launcherRoot = resolve(process.env.AQ_LAUNCHER_ROOT!)
for (const [index, source] of demoWorkspaces.entries()) {
  const workspace = { ...source, dir: resolve(launcherRoot, source.id) }
  demoWorkspaces[index] = workspace
  await mkdir(workspace.dir, { recursive: true })
  for (const path of demoWorkspaceFilePaths[workspace.id] ?? []) {
    const content = demoWorkspaceFiles[path]!
    const file = resolve(workspace.dir, path)
    if (!file.startsWith(workspace.dir + sep)) throw new Error('Invalid demo fixture path')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}
await mkdir(launcherRoot, { recursive: true })
await writeFile(resolve(launcherRoot, 'workspaces.json'), JSON.stringify({ workspaces: demoWorkspaces }))

const mime: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}
process.on('message', async (raw: unknown) => {
  const msg = raw as { type: string; id: string; method: string; url: string; headers: [string, string][]; body?: Buffer }
  if (msg.type !== 'openalice:web:request') return
  let response: Response
  try {
    const url = new URL(msg.url)
    if (url.protocol !== 'app:' || url.host !== 'openalice') throw new Error('Invalid demo origin')
    if (url.pathname.startsWith('/api/')) {
      // Relative MSW paths resolve against a HTTP base, independent of app://.
      const baseUrl = 'http://demo.openalice.local'
      const request = new Request(baseUrl + url.pathname + url.search, {
        method: msg.method, headers: msg.headers,
        ...(msg.body ? { body: new Uint8Array(msg.body) } : {}),
      })
      response = await getResponse(apiHandlers, request, { baseUrl })
        ?? Response.json({ error: 'demo_not_implemented', path: url.pathname }, { status: 501 })
    } else {
      const path = decodeURIComponent(url.pathname)
      const file = resolve(uiRoot, '.' + path)
      if (file !== uiRoot && !file.startsWith(uiRoot + sep)) throw new Error('Invalid asset path')
      const asset = extname(path) ? file : resolve(uiRoot, 'index.html')
      response = new Response(new Uint8Array(await readFile(asset)), {
        headers: { 'content-type': mime[extname(asset)] ?? 'application/octet-stream' },
      })
    }
  } catch (error) {
    response = Response.json({ error: String(error) }, { status: 500 })
  }
  process.send?.({ type: 'openalice:web:response', id: msg.id, status: response.status,
    headers: [...response.headers], body: response.body ? Buffer.from(await response.arrayBuffer()) : null })
})
process.on('disconnect', () => process.exit(0))
process.send?.({ type: 'demo:ready' })
