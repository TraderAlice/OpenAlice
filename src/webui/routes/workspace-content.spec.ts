import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, symlink, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceContentRoutes } from './workspace-content.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
it('resolves metadata and bytes but rejects traversal, absent files and escaping symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'content-')); roots.push(root)
  await writeFile(join(root, 'report.html'), '<script>alert(1)</script>')
  const outside = await mkdtemp(join(tmpdir(), 'outside-')); roots.push(outside)
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(outside, join(root, 'outside'))
  const app = createWorkspaceContentRoutes(id => id === 'ws' ? root : undefined)
  const get = (path: string, suffix = '') => app.request(`/ws/content?path=${encodeURIComponent(path)}${suffix}`)
  expect(await (await get('report.html', '&metadata=1')).json()).toMatchObject({ path: 'report.html' })
  const response = await get('report.html')
  expect(response.headers.get('content-type')).toBe('application/octet-stream')
  expect(response.headers.get('content-security-policy')).toContain('sandbox')
  expect(await response.text()).toBe('<script>alert(1)</script>')
  expect((await get('../secret.txt')).status).toBe(404)
  expect((await get('missing.pdf')).status).toBe(404)
  expect((await get('outside/secret.txt')).status).toBe(404)
})

it('serves image bytes and bounds content without blocking metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'content-')); roots.push(root)
  const app = createWorkspaceContentRoutes(() => root)
  await writeFile(join(root, 'wave.png'), new Uint8Array([137, 80, 78, 71]))
  const response = await app.request('/ws/content?path=wave.png')
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
  await writeFile(join(root, 'large.bin'), '')
  await truncate(join(root, 'large.bin'), 17 * 1024 * 1024)
  expect((await app.request('/ws/content?path=large.bin')).status).toBe(413)
  expect((await app.request('/ws/content?path=large.bin&metadata=1')).status).toBe(200)
})
